import {
  buildShape,
  horizontalIntersections,
  pingPong01,
  pointAtPath,
  rayIntersections,
  verticalIntersections,
  wrap01,
} from "./src/geometry.js";
import {
  rebaseContinuousPosition,
  rebasePingPongPosition,
} from "./src/articulation.js";
import {
  canonicalHeadOffsets,
  sanitizeHeadOffsets,
  updateHeadOffset,
  wrapOffset,
} from "./src/playheads.js";
import {
  cloneDefaultFmDrumVoices,
  FM_DRUM_STORAGE_KEY,
  FmDrumAudio,
  sanitizeFmDrumVoice,
} from "./src/fm-drums.js";
import {
  limitShapeDrumHits,
  mappedShapeDrumVoice,
  reversedShapeHeadState,
  sanitizeShapeSideSubdivisions,
  SHAPE_DRUM_MAPPING_MODES,
  shapeDrumEventToken,
  shapeDrumVoiceIndex,
  shapeRotationTravelForAngle,
  shapeSideSubdivision,
} from "./src/shape-drums.js";
import { installShapesNativeBridge } from "./src/shapes-native-bridge.js";

const $ = (id) => document.getElementById(id);
const TAU = Math.PI * 2;
const SPEED_MAX = 4;
const SPEED_CURVE = 5.6;
const HEAD_COLORS = ["#5fe8c4", "#7db4ff", "#c79bff", "#ffb86b"];
const audio = new FmDrumAudio(globalThis);
const defaults = {
  sides: 4,
  closedShapeType: "polygon",
  starDepth: .48,
  curvature: 0,
  aspect: 0,
  skew: 0,
  rotation: 0,
  rotationSpeed: .12,
  rotationDirection: 1,
  rotationMotionMode: "loop",
  playMethod: "trace",
  heads: 1,
  motionMode: "loop",
  position: 0,
  speed: .06,
  traversalDirection: 1,
  mappingMode: "contour-corner",
  sideSubdivisions: 2,
  pitchDepth: 12,
  characterDepth: .7,
  strikeLimit: 6,
  output: .65,
};
const state = {
  ...defaults,
  shapeType: "polygon",
  continuousPosition: defaults.position,
  continuousRotation: 0,
  headOffsets: [0],
  scanLineAxes: Array(12).fill("vertical"),
  traceHeadDirections: Array(12).fill(1),
  radialHeadDirections: Array(12).fill(1),
  traceHeadDirectionAdjustments: Array(12).fill(0),
  radialHeadDirectionAdjustments: Array(12).fill(0),
  playing: false,
  autoRotate: false,
  audioOn: false,
};
const voices = loadDrumBank();
const canvas = $("stage");
const stageWrap = $("stageWrap");
const drawing = canvas.getContext("2d");
const lastEventTokens = new Map();
const lastStrikeTimes = new Map();
let cssWidth = 1;
let cssHeight = 1;
let pixelRatio = 1;
let cachedShape = null;
let cachedShapeKey = "";
let scheduledFrame = 0;
let shapesHostParked = false;
let lastFrameTime = performance.now();
let suppressStrikes = 2;
let draggingHead = null;
let pointerGesture = null;

function clamp(value, minimum = 0, maximum = 1) {
  return Math.min(maximum, Math.max(minimum, Number(value) || 0));
}

function plural(count, singular, pluralForm = `${singular}s`) {
  return count === 1 ? singular : pluralForm;
}

function normalizeDegrees(value) {
  return ((Number(value) + 180) % 360 + 360) % 360 - 180;
}

function speedFromSlider(value) {
  const position = clamp(value);
  return SPEED_MAX * Math.expm1(SPEED_CURVE * position) / Math.expm1(SPEED_CURVE);
}

function sliderFromSpeed(value) {
  const speed = clamp(value, 0, SPEED_MAX);
  return Math.log1p(speed / SPEED_MAX * Math.expm1(SPEED_CURVE)) / SPEED_CURVE;
}

function loadDrumBank() {
  const fallback = cloneDefaultFmDrumVoices();
  try {
    const stored = JSON.parse(localStorage.getItem(FM_DRUM_STORAGE_KEY));
    if (!Array.isArray(stored) || stored.length !== fallback.length) return fallback;
    return fallback.map((voice) => {
      const saved = stored.find((candidate) => candidate?.id === voice.id);
      return sanitizeFmDrumVoice({ ...voice, ...saved, id: voice.id, key: voice.key });
    });
  } catch {
    return fallback;
  }
}

function announce(message) {
  $("liveStatus").textContent = message;
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

function invalidateGeometry() {
  cachedShape = null;
  cachedShapeKey = "";
  suppressStrikes = 2;
  lastEventTokens.clear();
  scheduleFrame();
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
    return true;
  } catch (error) {
    showError(error);
    return false;
  }
}

function effectiveHeadCount() {
  return state.heads;
}

function directionsForMethod(method = state.playMethod) {
  return method === "radial" ? state.radialHeadDirections : state.traceHeadDirections;
}

function directionAdjustmentsForMethod(method = state.playMethod) {
  return method === "radial"
    ? state.radialHeadDirectionAdjustments
    : state.traceHeadDirectionAdjustments;
}

function alignDirectionAdjustments(method) {
  if (method === "scan") return;
  const directions = directionsForMethod(method);
  const adjustments = directionAdjustmentsForMethod(method);
  for (let index = 0; index < state.heads; index += 1) {
    const direction = directions[index] < 0 ? -1 : 1;
    adjustments[index] = (1 - direction) * state.continuousPosition;
  }
}

function alignPointAndRadarDirections() {
  alignDirectionAdjustments("trace");
  alignDirectionAdjustments("radial");
}

function headDirection(headIndex, method = state.playMethod) {
  if (method === "scan") return 1;
  return directionsForMethod(method)[headIndex] < 0 ? -1 : 1;
}

function phaseOffsetForHead(headIndex) {
  return sanitizeHeadOffsets(state.headOffsets, state.heads)[headIndex] ?? 0;
}

function directionalHeadTravel(position, headIndex, method = state.playMethod) {
  return headDirection(headIndex, method) * position
    + phaseOffsetForHead(headIndex)
    + (directionAdjustmentsForMethod(method)[headIndex] ?? 0);
}

function phaseForHead(position, headIndex, method = state.playMethod) {
  const travel = directionalHeadTravel(position, headIndex, method);
  return state.motionMode === "pingpong" ? pingPong01(travel) : wrap01(travel);
}

function scanAxisForHead(headIndex) {
  return state.scanLineAxes[headIndex] === "horizontal" ? "horizontal" : "vertical";
}

function currentShape() {
  const key = [
    state.sides,
    state.shapeType,
    state.starDepth.toFixed(4),
    state.curvature.toFixed(4),
    state.aspect.toFixed(4),
    state.skew.toFixed(4),
    state.rotation.toFixed(4),
  ].join("|");
  if (cachedShape && cachedShapeKey === key) return cachedShape;
  cachedShapeKey = key;
  cachedShape = buildShape({
    sides: state.sides,
    shapeType: state.shapeType,
    starDepth: state.starDepth,
    curvature: state.curvature,
    aspect: state.aspect,
    skew: state.skew,
    rotationDeg: state.rotation,
    samplesPerEdge: 48,
  });
  return cachedShape;
}

function tangentForContact(contact, path) {
  if (Number.isFinite(contact?.tangent?.x) && Number.isFinite(contact?.tangent?.y)) {
    return contact.tangent;
  }
  const cornerIndex = Math.max(0, contact?.cornerIndex ?? 0);
  const pointIndex = path.vertexIndices[cornerIndex] ?? 0;
  const previous = path.points[(pointIndex - 1 + path.points.length) % path.points.length];
  const next = path.points[(pointIndex + 1) % path.points.length];
  const length = Math.hypot(next.x - previous.x, next.y - previous.y) || 1;
  return { x: (next.x - previous.x) / length, y: (next.y - previous.y) / length };
}

function incidenceForContact(contact, path) {
  if (state.playMethod === "trace") return 0;
  const tangent = tangentForContact(contact, path);
  const normal = { x: -tangent.y, y: tangent.x };
  let velocity;
  if (contact.scanAxis === "horizontal") {
    velocity = { x: 0, y: 1 };
  } else if (contact.scanAxis === "radial") {
    velocity = { x: -contact.y, y: contact.x };
  } else {
    velocity = { x: 1, y: 0 };
  }
  const length = Math.hypot(velocity.x, velocity.y) || 1;
  return clamp(Math.abs((velocity.x * normal.x + velocity.y * normal.y) / length));
}

function scannerAt(path, position, headIndex) {
  const headTravel = position + phaseOffsetForHead(headIndex);
  const phase = state.motionMode === "pingpong" ? pingPong01(headTravel) : wrap01(headTravel);
  const axis = scanAxisForHead(headIndex);
  const minimum = axis === "horizontal" ? path.bounds.minY : path.bounds.minX;
  const maximum = axis === "horizontal" ? path.bounds.maxY : path.bounds.maxX;
  return {
    headIndex,
    headTravel,
    phase,
    axis,
    coordinate: minimum + phase * (maximum - minimum),
  };
}

function radialAt(path, position, headIndex) {
  const headTravel = directionalHeadTravel(position, headIndex, "radial");
  const phase = state.motionMode === "pingpong" ? pingPong01(headTravel) : wrap01(headTravel);
  const angle = phase * TAU - Math.PI / 2;
  const contacts = rayIntersections(path, angle)
    .filter((contact) => path.closed || contact.rayDistance > .015)
    .map((contact, contactIndex) => ({
      ...contact,
      headIndex,
      headTravel,
      headPhase: phase,
      scanAxis: "radial",
      voiceKey: `radial:${headIndex}:${contactIndex}`,
    }));
  return { headIndex, headTravel, phase, angle, contacts };
}

function collectContacts(path, position = state.continuousPosition) {
  const contacts = [];
  const heads = [];
  for (let headIndex = 0; headIndex < effectiveHeadCount(); headIndex += 1) {
    if (state.playMethod === "scan") {
      const scanner = scannerAt(path, position, headIndex);
      const intersections = (
        scanner.axis === "horizontal"
          ? horizontalIntersections(path, scanner.coordinate)
          : verticalIntersections(path, scanner.coordinate)
      ).map((contact, contactIndex) => ({
        ...contact,
        headIndex,
        headTravel: scanner.headTravel,
        headPhase: scanner.phase,
        scanAxis: scanner.axis,
        voiceKey: `scan:${scanner.axis}:${headIndex}:${contactIndex}`,
      }));
      heads.push({ ...scanner, contacts: intersections });
      contacts.push(...intersections);
    } else if (state.playMethod === "radial") {
      const radial = radialAt(path, position, headIndex);
      heads.push(radial);
      contacts.push(...radial.contacts);
    } else {
      const headTravel = directionalHeadTravel(position, headIndex, "trace");
      const phase = phaseForHead(position, headIndex, "trace");
      const contact = {
        ...pointAtPath(path, phase),
        headIndex,
        headTravel,
        headPhase: phase,
        scanAxis: "trace",
        voiceKey: `trace:${headIndex}`,
      };
      heads.push({ headIndex, phase, contact });
      contacts.push(contact);
    }
  }
  for (const contact of contacts) {
    contact.incidence = incidenceForContact(contact, path);
  }
  return { contacts, heads };
}

function populateMappingModes() {
  const fragment = document.createDocumentFragment();
  for (const mode of SHAPE_DRUM_MAPPING_MODES) {
    const option = document.createElement("option");
    option.value = mode.id;
    option.textContent = mode.label;
    fragment.append(option);
  }
  $("mappingMode").replaceChildren(fragment);
  $("mappingMode").value = state.mappingMode;
}

function renderDrumMap() {
  const fragment = document.createDocumentFragment();
  voices.forEach((voice, index) => {
    const cell = document.createElement("button");
    cell.type = "button";
    cell.className = "shape-drum-cell";
    cell.dataset.voiceIndex = String(index);
    cell.style.setProperty("--voice-color", voice.color);
    cell.setAttribute("aria-label", `Preview ${voice.name} with ${voice.key.toUpperCase()}`);
    const name = document.createElement("b");
    const key = document.createElement("small");
    name.textContent = voice.name;
    key.textContent = voice.key.toUpperCase();
    cell.append(name, key);
    cell.addEventListener("click", () => void previewVoice(index));
    fragment.append(cell);
  });
  $("drumMap").replaceChildren(fragment);
}

function flashVoice(index) {
  const cell = $("drumMap").querySelector(`[data-voice-index="${index}"]`);
  if (!cell) return;
  cell.classList.add("is-active");
  clearTimeout(Number(cell.dataset.clearTimer) || 0);
  cell.dataset.clearTimer = String(
    setTimeout(() => cell.classList.remove("is-active"), 150),
  );
}

async function previewVoice(index) {
  const voice = voices[index];
  if (!voice) return;
  if (!state.audioOn && !await enableAudio()) return;
  try {
    await audio.trigger(voice);
    flashVoice(index);
    $("mappingReadout").textContent = `MANUAL · ${voice.key.toUpperCase()} → ${voice.name}`;
    announce(`${voice.name} preview.`);
  } catch (error) {
    showError(error);
  }
}

function mappingOptions(path) {
  return {
    mode: state.mappingMode,
    bounds: path.bounds,
    path,
    sideSubdivisions: state.sideSubdivisions,
  };
}

function mappingOriginText() {
  const strikeOrigin = state.sides === 1
    ? "Circles have no sides, so subdivisions are inactive."
    : state.sides === 2
      ? "Side 1 begins at the start marker and follows the open line."
      : "Side 1 begins at the start marker and follows the contour clockwise.";
  if (state.mappingMode === "position-grid") {
    return `Voice-grid origin is upper-left; rows run down and columns run right. ${strikeOrigin}`;
  }
  if (state.mappingMode === "incidence-playhead") {
    return `Voice rows begin with playhead 1; columns run from glancing to direct. ${strikeOrigin}`;
  }
  return `Origin: ${strikeOrigin} Subdivisions count forward from each side's first corner.`;
}

function updateMappingLegend(mode) {
  for (let index = 0; index < 5; index += 1) {
    const item = mode?.legend?.[index];
    $(`mappingLegendSource${index}`).textContent = item?.source ?? "";
    $(`mappingLegendTarget${index}`).textContent = item?.target ?? "";
  }
  $("mappingLegend").setAttribute(
    "aria-label",
    `${mode?.label ?? "Current"} contact mappings`,
  );
}

function contactSubdivisionLabel(contact, path) {
  const subdivision = shapeSideSubdivision(contact, path, state.sideSubdivisions);
  if (subdivision) {
    return [
      `SIDE ${subdivision.sideIndex + 1}`,
      `SUB ${subdivision.subdivisionIndex + 1}/${subdivision.subdivisions}`,
    ].join(" · ");
  }
  return `PHASE ${Math.round(wrap01(contact?.u) * 100)}%`;
}

function updateHitCapStatus(sounded = null, candidates = null) {
  const limit = Math.round(state.strikeLimit);
  const output = $("hitCapStatus");
  output.classList.remove("is-limited");
  if (!Number.isFinite(sounded) || !Number.isFinite(candidates)) {
    output.textContent = `Up to ${limit} new geometry ${plural(limit, "contact")} can sound together.`;
    return;
  }
  const skipped = Math.max(0, candidates - sounded);
  output.textContent = skipped
    ? `${sounded} sounded · ${skipped} skipped by the ${limit}-hit cap.`
    : `${sounded} ${plural(sounded, "hit")} sounded together · cap ${limit}.`;
  if (skipped) output.classList.add("is-limited");
}

function triggerContacts(contacts, path, now) {
  const nextTokens = new Map();
  const frameVoices = new Set();
  const candidates = [];
  for (const contact of contacts) {
    const voiceIndex = shapeDrumVoiceIndex(contact, mappingOptions(path));
    const token = shapeDrumEventToken(
      contact,
      path,
      state.sideSubdivisions,
      voiceIndex,
    );
    nextTokens.set(contact.voiceKey, token);
    if (
      !state.audioOn
      || suppressStrikes > 0
      || lastEventTokens.get(contact.voiceKey) === token
    ) {
      continue;
    }
    const lastStrike = lastStrikeTimes.get(voiceIndex) ?? Number.NEGATIVE_INFINITY;
    if (now - lastStrike < 70 || frameVoices.has(voiceIndex)) continue;
    frameVoices.add(voiceIndex);
    candidates.push({ contact, voiceIndex });
  }

  const selected = limitShapeDrumHits(candidates, state.strikeLimit);
  for (const { contact, voiceIndex } of selected) {
    lastStrikeTimes.set(voiceIndex, now);
    const voice = mappedShapeDrumVoice(voices[voiceIndex], contact, {
      bounds: path.bounds,
      pitchDepth: state.pitchDepth,
      characterDepth: state.characterDepth,
      contactCount: contacts.length,
    });
    audio.trigger(voice).catch(showError);
    flashVoice(voiceIndex);
    $("mappingReadout").textContent = [
      contactSubdivisionLabel(contact, path),
      `${Math.round((contact.tangentAngle || 0) * 180 / Math.PI)}°`,
      `→ ${voice.name}`,
      `${Math.round(voice.frequency)} HZ`,
      `HITS ${selected.length}/${Math.round(state.strikeLimit)}`,
    ].join(" · ");
  }
  if (candidates.length) updateHitCapStatus(selected.length, candidates.length);
  lastEventTokens.clear();
  for (const [key, token] of nextTokens) lastEventTokens.set(key, token);
}

function canvasTransform() {
  const scale = Math.min(cssWidth, cssHeight) * .39;
  return {
    scale,
    centerX: cssWidth * .5,
    centerY: cssHeight * .5,
    x: (value) => cssWidth * .5 + value * scale,
    y: (value) => cssHeight * .5 + value * scale,
  };
}

function drawShape(path, transform) {
  drawing.beginPath();
  path.points.forEach((point, index) => {
    if (index) drawing.lineTo(transform.x(point.x), transform.y(point.y));
    else drawing.moveTo(transform.x(point.x), transform.y(point.y));
  });
  if (path.closed) drawing.closePath();
  if (path.closed) {
    drawing.fillStyle = "rgba(232, 196, 107, .025)";
    drawing.fill();
  }
  drawing.strokeStyle = "rgba(232, 196, 107, .9)";
  drawing.lineWidth = path.closed ? 1.5 : 2;
  drawing.lineJoin = "round";
  drawing.lineCap = "round";
  drawing.stroke();

  if (state.sideSubdivisions > 1 && path.vertexDistances.length) {
    const sideCount = path.closed
      ? path.vertexDistances.length
      : Math.max(0, path.vertexDistances.length - 1);
    drawing.save();
    drawing.beginPath();
    for (let sideIndex = 0; sideIndex < sideCount; sideIndex += 1) {
      const start = path.vertexDistances[sideIndex];
      const end = sideIndex + 1 < path.vertexDistances.length
        ? path.vertexDistances[sideIndex + 1]
        : path.totalLength;
      for (let subdivision = 1; subdivision < state.sideSubdivisions; subdivision += 1) {
        const distance = start + (end - start) * subdivision / state.sideSubdivisions;
        const contact = pointAtPath(path, distance / path.totalLength);
        const x = transform.x(contact.x);
        const y = transform.y(contact.y);
        const normal = { x: -contact.tangent.y, y: contact.tangent.x };
        drawing.moveTo(x - normal.x * 2.7, y - normal.y * 2.7);
        drawing.lineTo(x + normal.x * 2.7, y + normal.y * 2.7);
      }
    }
    drawing.strokeStyle = "rgba(232, 196, 107, .42)";
    drawing.lineWidth = 1;
    drawing.stroke();
    drawing.restore();
  }

  path.vertexIndices.forEach((pointIndex, index) => {
    const point = path.points[pointIndex];
    drawing.beginPath();
    drawing.arc(transform.x(point.x), transform.y(point.y), 3.5, 0, TAU);
    drawing.fillStyle = "#07090b";
    drawing.fill();
    drawing.strokeStyle = (path.cornerTurns[index] ?? 0) < 0
      ? "rgba(199, 155, 255, .9)"
      : "rgba(232, 196, 107, .78)";
    drawing.lineWidth = 1;
    drawing.stroke();
  });

  const originIndex = path.vertexIndices[0];
  const origin = path.points[originIndex];
  if (origin) {
    const x = transform.x(origin.x);
    const y = transform.y(origin.y);
    const dx = x - transform.centerX;
    const dy = y - transform.centerY;
    const distance = Math.hypot(dx, dy) || 1;
    const nx = dx / distance;
    const ny = dy / distance;
    drawing.save();
    drawing.beginPath();
    drawing.arc(x, y, 7, 0, TAU);
    drawing.strokeStyle = "rgba(255, 243, 214, .88)";
    drawing.lineWidth = 1;
    drawing.stroke();
    drawing.beginPath();
    drawing.moveTo(x + nx * 8.5, y + ny * 8.5);
    drawing.lineTo(x + nx * 13, y + ny * 13);
    drawing.strokeStyle = "rgba(255, 243, 214, .74)";
    drawing.lineWidth = 1.5;
    drawing.lineCap = "round";
    drawing.stroke();
    drawing.beginPath();
    drawing.arc(x + nx * 13, y + ny * 13, 1.8, 0, TAU);
    drawing.fillStyle = "#fff3d6";
    drawing.fill();
    drawing.restore();
  }
}

function addScannerPath(scanner, transform, extent = 1.14) {
  drawing.beginPath();
  if (scanner.axis === "horizontal") {
    drawing.moveTo(transform.x(-extent), transform.y(scanner.coordinate));
    drawing.lineTo(transform.x(extent), transform.y(scanner.coordinate));
  } else {
    drawing.moveTo(transform.x(scanner.coordinate), transform.y(-extent));
    drawing.lineTo(transform.x(scanner.coordinate), transform.y(extent));
  }
}

function drawFrame(path, active) {
  drawing.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
  drawing.clearRect(0, 0, cssWidth, cssHeight);
  const transform = canvasTransform();
  drawing.save();
  drawing.setLineDash([3, 7]);
  drawing.strokeStyle = "rgba(214, 232, 226, .2)";
  drawing.lineWidth = 1;
  drawing.beginPath();
  drawing.moveTo(transform.x(-1.1), transform.y(0));
  drawing.lineTo(transform.x(1.1), transform.y(0));
  drawing.moveTo(transform.x(0), transform.y(-1.1));
  drawing.lineTo(transform.x(0), transform.y(1.1));
  drawing.stroke();
  drawing.setLineDash([]);
  drawing.restore();
  drawShape(path, transform);

  for (const head of active.heads) {
    const color = HEAD_COLORS[head.headIndex % HEAD_COLORS.length];
    if (state.playMethod === "scan") {
      addScannerPath(head, transform);
      drawing.strokeStyle = color;
      drawing.globalAlpha = .72;
      drawing.lineWidth = head.headIndex ? 1 : 1.5;
      drawing.stroke();
    } else if (state.playMethod === "radial") {
      drawing.beginPath();
      drawing.moveTo(transform.centerX, transform.centerY);
      drawing.lineTo(
        transform.x(Math.cos(head.angle) * 1.14),
        transform.y(Math.sin(head.angle) * 1.14),
      );
      drawing.strokeStyle = color;
      drawing.globalAlpha = .72;
      drawing.lineWidth = head.headIndex ? 1 : 1.5;
      drawing.stroke();
    }
  }
  drawing.globalAlpha = 1;

  for (const contact of active.contacts) {
    const voiceIndex = shapeDrumVoiceIndex(contact, mappingOptions(path));
    const x = transform.x(contact.x);
    const y = transform.y(contact.y);
    drawing.save();
    drawing.shadowColor = voices[voiceIndex].color;
    drawing.shadowBlur = 14;
    drawing.fillStyle = "#fff3d6";
    drawing.beginPath();
    drawing.arc(x, y, 5.2, 0, TAU);
    drawing.fill();
    drawing.shadowBlur = 0;
    drawing.strokeStyle = voices[voiceIndex].color;
    drawing.lineWidth = 1.5;
    drawing.stroke();
    drawing.restore();
  }
}

function updateSectionSummaries(contacts = []) {
  const reader = state.playMethod === "scan"
    ? "Lines"
    : state.playMethod === "radial" ? "Radar" : "Points";
  $("playSummary").textContent = `${reader} · ${state.playing ? "playing" : "paused"}`;
  $("formSummary").textContent = state.sides === 1
    ? "circle · no corners"
    : state.sides === 2
      ? "open line"
      : `${state.sides}-point ${state.closedShapeType}`;
  const mode = SHAPE_DRUM_MAPPING_MODES.find(({ id }) => id === state.mappingMode);
  const subdivisionSummary = state.sides === 1
    ? "circle"
    : `${state.sideSubdivisions}/side`;
  $("mappingSummary").textContent = `${mode?.label.toLowerCase() ?? "custom"} · ${subdivisionSummary}`;
  $("mappingDescription").textContent = mode?.description ?? "";
  $("mappingOrigin").textContent = mappingOriginText();
  updateMappingLegend(mode);
  const circle = state.sides === 1;
  const subdivisionsControl = $("sideSubdivisionsControl");
  $("sideSubdivisions").disabled = circle;
  subdivisionsControl.classList[circle ? "add" : "remove"]("is-disabled");
  $("sideSubdivisionsOut").textContent = circle
    ? "inactive"
    : String(state.sideSubdivisions);
  $("sideSubdivisions").setAttribute(
    "aria-valuetext",
    circle
      ? "Unavailable for circles"
      : `${state.sideSubdivisions} ${plural(state.sideSubdivisions, "subdivision")} per side`,
  );
  $("sideSubdivisionsHelp").textContent = circle
    ? "Circles have no polygon sides; continuous contour phase selects their rows."
    : `Each side has ${state.sideSubdivisions} equal ${plural(state.sideSubdivisions, "strike region")}.`;
  const count = effectiveHeadCount();
  const noun = state.playMethod === "scan"
    ? "LINE"
    : state.playMethod === "radial" ? "RAY" : "POINT";
  $("stageReadout").textContent = [
    `${count} ${plural(count, noun)}`,
    `${contacts.length} ${plural(contacts.length, "CONTACT")}`,
    state.playing || state.autoRotate ? "PLAYING" : "PAUSED",
    state.audioOn ? "AUDIO ON" : "AUDIO OFF",
  ].join(" · ");
}

function updatePlayheadReadouts() {
  const radar = state.playMethod === "radial";
  $("positionLabel").textContent = radar ? "Radar angle" : "Playhead position";
  $("speedLabel").textContent = radar ? "Radar speed" : "Playhead speed";
  $("positionOut").textContent = radar
    ? `${(state.position * 360).toFixed(1)}°`
    : `${(state.position * 100).toFixed(1)}%`;
  $("speedOut").textContent = `${state.speed.toFixed(3)} ${radar ? "rev/s" : "cyc/s"}`;
}

function renderHeadLayout() {
  const count = effectiveHeadCount();
  const offsets = sanitizeHeadOffsets(state.headOffsets, count);
  state.headOffsets = offsets;
  for (let index = 0; index < 12; index += 1) {
    const marker = $(`headMarker${index}`);
    const option = $(`headOption${index}`);
    const hidden = index >= count;
    marker.hidden = hidden;
    option.hidden = hidden;
    if (hidden) continue;
    const phase = wrapOffset(offsets[index]);
    const color = HEAD_COLORS[index % HEAD_COLORS.length];
    marker.style.left = `${phase * 100}%`;
    marker.style.top = "58%";
    marker.style.setProperty("--head-color", color);
    marker.setAttribute("role", "slider");
    marker.setAttribute("aria-valuenow", phase.toFixed(3));
    marker.setAttribute("aria-valuetext", `${(phase * 100).toFixed(1)} percent relative phase`);
    option.style.left = `${phase * 100}%`;
    option.style.setProperty("--head-color", color);
    if (state.playMethod === "scan") {
      const horizontal = scanAxisForHead(index) === "horizontal";
      option.textContent = horizontal ? "—" : "│";
      setPressed(option, horizontal);
      option.setAttribute("aria-label", `Line ${index + 1} ${horizontal ? "horizontal" : "vertical"}; rotate 90 degrees`);
    } else {
      const reverse = headDirection(index) < 0;
      option.textContent = reverse ? "←" : "→";
      setPressed(option, reverse);
      option.setAttribute(
        "aria-label",
        `${state.playMethod === "radial" ? "Radar ray" : "Point"} ${index + 1} ${reverse ? "reverse" : "forward"}; change direction`,
      );
    }
  }
}

function updatePlayheadControls() {
  const scan = state.playMethod === "scan";
  const count = effectiveHeadCount();
  const noun = scan ? "line" : state.playMethod === "radial" ? "ray" : "point";
  $("heads").value = String(state.heads);
  $("headsOut").textContent = `${state.heads} ${plural(state.heads, "playhead")}`;
  $("playheadCountOut").textContent = `${count} ${plural(count, noun)}`;
  $("removePlayhead").disabled = count <= 1;
  $("addPlayhead").disabled = count >= 12;
  for (const button of $("playMethod").querySelectorAll("button")) {
    setPressed(button, button.dataset.value === state.playMethod);
  }
  renderHeadLayout();
  updatePlayheadReadouts();
  updateTraversalDirection();
  updateSectionSummaries();
}

function updateTraversalDirection() {
  const forward = state.traversalDirection > 0;
  const bouncing = state.motionMode === "pingpong";
  const openPoints = state.playMethod === "trace" && state.sides === 2;
  const closedPoints = state.playMethod === "trace" && state.sides !== 2;
  const radial = state.playMethod === "radial";
  const text = bouncing
    ? (forward ? "FWD" : "REV")
    : openPoints
      ? (forward ? "FWD" : "REV")
      : closedPoints || radial
        ? (forward ? "CW" : "CCW")
        : (forward ? "L→R" : "R→L");
  const label = bouncing
    ? `${forward ? "Forward" : "Reverse"} ping-pong travel`
    : openPoints
      ? `${forward ? "Forward" : "Reverse"} point traversal`
      : closedPoints || radial
        ? `${radial ? "Radar sweep" : "Trace"} ${forward ? "clockwise" : "counterclockwise"}`
        : `Scan ${forward ? "left to right" : "right to left"}`;
  $("traversalDirectionGlyph").textContent = forward ? "→" : "←";
  $("traversalDirectionText").textContent = text;
  $("traversalDirection").setAttribute("aria-label", `Playhead direction: ${label}`);
}

function syncFormTopology() {
  const circle = state.sides === 1;
  const closed = state.sides >= 3;
  state.shapeType = circle ? "circle" : closed ? state.closedShapeType : "polygon";
  $("closedShapeControl").hidden = !closed;
  $("starDepthControl").hidden = !closed || state.closedShapeType !== "star";
  $("curvatureControl").hidden = circle;
  for (const button of $("closedShapeType").querySelectorAll("button")) {
    setPressed(button, button.dataset.value === state.closedShapeType);
  }
  $("sidesOut").textContent = state.sides === 1
    ? "1 · circle"
    : state.sides === 2 ? "2 · open line" : `${state.sides} · ${state.closedShapeType}`;
  updateTraversalDirection();
  updateSectionSummaries();
  invalidateGeometry();
}

function setPlayMethod(method, shouldAnnounce = true) {
  state.playMethod = ["trace", "scan", "radial"].includes(method) ? method : "trace";
  state.continuousPosition = state.position;
  lastEventTokens.clear();
  suppressStrikes = 2;
  updatePlayheadControls();
  if (shouldAnnounce) announce(`${state.playMethod === "scan" ? "Line" : state.playMethod === "radial" ? "Radar" : "Point"} playheads selected.`);
  scheduleFrame();
}

function changePlayheadCount(delta) {
  state.heads = Math.round(clamp(state.heads + delta, 1, 12));
  state.headOffsets = canonicalHeadOffsets(state.heads);
  alignPointAndRadarDirections();
  updatePlayheadControls();
  lastEventTokens.clear();
  suppressStrikes = 2;
  announce(`${$("playheadCountOut").textContent} active.`);
  scheduleFrame();
}

function setPosition(value) {
  const nextPosition = state.motionMode === "pingpong" ? clamp(value) : wrap01(value);
  state.continuousPosition = state.motionMode === "pingpong"
    ? rebasePingPongPosition(state.continuousPosition, nextPosition)
    : rebaseContinuousPosition(state.continuousPosition, state.position, nextPosition);
  state.position = nextPosition;
  $("position").value = String(state.position);
  updatePlayheadReadouts();
  suppressStrikes = 1;
  scheduleFrame();
}

function setRotationAngle(value, shouldAnnounce = false) {
  state.rotation = normalizeDegrees(value);
  state.continuousRotation = shapeRotationTravelForAngle(
    state.rotation,
    state.rotationMotionMode,
  );
  $("rotation").value = String(state.rotation);
  $("rotationOut").textContent = `${Math.round(state.rotation)}°`;
  invalidateGeometry();
  if (shouldAnnounce) announce(`Rotation reset to ${Math.round(state.rotation)} degrees.`);
}

function setRotationPlaying(playing) {
  state.autoRotate = Boolean(playing);
  setPressed($("rotationPlayButton"), state.autoRotate);
  $("rotationPlayButton").setAttribute("aria-label", state.autoRotate ? "Pause rotation" : "Start rotation");
  lastFrameTime = performance.now();
  announce(state.autoRotate ? "Rotation playing." : "Rotation paused.");
  scheduleFrame();
}

function resizeCanvas() {
  const bounds = stageWrap.getBoundingClientRect();
  cssWidth = Math.max(1, Math.round(bounds.width));
  cssHeight = Math.max(1, Math.round(bounds.height));
  pixelRatio = Math.max(1, Math.min(window.devicePixelRatio || 1, 2.5));
  canvas.width = Math.round(cssWidth * pixelRatio);
  canvas.height = Math.round(cssHeight * pixelRatio);
  canvas.style.width = `${cssWidth}px`;
  canvas.style.height = `${cssHeight}px`;
  scheduleFrame();
}

function frame(now) {
  scheduledFrame = 0;
  const deltaSeconds = Math.min(.1, Math.max(0, (now - lastFrameTime) / 1_000));
  lastFrameTime = now;
  if (state.playing) {
    state.continuousPosition += state.traversalDirection * state.speed * deltaSeconds;
    state.position = state.motionMode === "pingpong"
      ? pingPong01(state.continuousPosition)
      : wrap01(state.continuousPosition);
  }
  if (state.autoRotate) {
    state.continuousRotation += state.rotationDirection * state.rotationSpeed * deltaSeconds;
    state.rotation = state.rotationMotionMode === "pingpong"
      ? pingPong01(state.continuousRotation) * 360 - 180
      : normalizeDegrees(state.continuousRotation * 360);
    cachedShape = null;
  }
  const path = currentShape();
  const active = collectContacts(path);
  if (state.playing || state.autoRotate) triggerContacts(active.contacts, path, now);
  if (suppressStrikes > 0) suppressStrikes -= 1;
  drawFrame(path, active);
  $("position").value = String(state.position);
  $("rotation").value = String(state.rotation);
  $("rotationOut").textContent = `${Math.round(state.rotation)}°`;
  updatePlayheadReadouts();
  updateSectionSummaries(active.contacts);
  if (state.playing || state.autoRotate) scheduleFrame();
}

function resetForm(shouldAnnounce = true) {
  state.closedShapeType = defaults.closedShapeType;
  state.starDepth = defaults.starDepth;
  state.curvature = defaults.curvature;
  state.aspect = defaults.aspect;
  state.skew = defaults.skew;
  for (const [id, value] of [
    ["starDepth", state.starDepth],
    ["curvature", state.curvature],
    ["aspect", state.aspect],
    ["skew", state.skew],
  ]) $(id).value = String(value);
  $("starDepthOut").textContent = "48%";
  $("curvatureOut").textContent = "straight";
  $("aspectOut").textContent = "even";
  $("skewOut").textContent = "0%";
  syncFormTopology();
  if (shouldAnnounce) announce("Form reset.");
}

function reset() {
  const audioOn = state.audioOn;
  Object.assign(state, defaults, {
    shapeType: "polygon",
    continuousPosition: defaults.position,
    continuousRotation: 0,
    headOffsets: [0],
    scanLineAxes: Array(12).fill("vertical"),
    traceHeadDirections: Array(12).fill(1),
    radialHeadDirections: Array(12).fill(1),
    traceHeadDirectionAdjustments: Array(12).fill(0),
    radialHeadDirectionAdjustments: Array(12).fill(0),
    playing: false,
    autoRotate: false,
    audioOn,
  });
  for (const [id, value] of [
    ["sides", state.sides],
    ["position", state.position],
    ["speed", sliderFromSpeed(state.speed)],
    ["rotation", state.rotation],
    ["rotationSpeed", state.rotationSpeed],
    ["sideSubdivisions", state.sideSubdivisions],
    ["pitchDepth", state.pitchDepth],
    ["characterDepth", state.characterDepth],
    ["strikeLimit", state.strikeLimit],
    ["output", state.output],
  ]) $(id).value = String(value);
  $("sideSubdivisionsOut").textContent = String(state.sideSubdivisions);
  $("sideSubdivisions").setAttribute(
    "aria-valuetext",
    `${state.sideSubdivisions} ${plural(state.sideSubdivisions, "subdivision")} per side`,
  );
  $("pitchDepthOut").textContent = `±${state.pitchDepth} st`;
  $("characterDepthOut").textContent = `${Math.round(state.characterDepth * 100)}%`;
  $("strikeLimitOut").textContent = `${state.strikeLimit} max`;
  $("strikeLimit").setAttribute(
    "aria-valuetext",
    `${state.strikeLimit} simultaneous ${plural(state.strikeLimit, "hit")} maximum`,
  );
  $("outputOut").textContent = `${Math.round(state.output * 100)}%`;
  $("rotationSpeedOut").textContent = `${state.rotationSpeed.toFixed(2)} rev/s`;
  $("mappingMode").value = state.mappingMode;
  setPressed($("playButton"), false);
  setPressed($("rotationPlayButton"), false);
  $("playButton").setAttribute("aria-label", "Play playhead");
  $("rotationPlayButton").setAttribute("aria-label", "Start rotation");
  for (const button of $("playheadMotion").querySelectorAll("button[data-value]")) {
    setPressed(button, button.dataset.value === state.motionMode);
  }
  for (const button of $("rotationMotion").querySelectorAll("button[data-value]")) {
    setPressed(button, button.dataset.value === state.rotationMotionMode);
  }
  $("rotationDirectionGlyph").textContent = "→";
  $("rotationDirectionText").textContent = "CW";
  resetForm(false);
  updatePlayheadControls();
  if (state.audioOn) audio.setOutput(state.output);
  lastStrikeTimes.clear();
  $("mappingReadout").textContent = "SIDE 1 · SUB 1/2 · 0° → SUB KICK · HITS 0/6";
  updateHitCapStatus();
  invalidateGeometry();
  announce("Shape Drum Machine reset.");
}

$("audioButton").addEventListener("click", async () => {
  if (state.audioOn) {
    setAudioState(false);
    announce("Shape drums audio off.");
  } else if (await enableAudio()) {
    announce("Shape drums audio on.");
  }
  scheduleFrame();
});

$("playButton").addEventListener("click", () => {
  state.playing = !state.playing;
  setPressed($("playButton"), state.playing);
  $("playButton").setAttribute("aria-label", state.playing ? "Pause playhead" : "Play playhead");
  lastFrameTime = performance.now();
  lastEventTokens.clear();
  suppressStrikes = state.playing ? 2 : 0;
  announce(state.playing ? "Shape playing." : "Shape paused.");
  scheduleFrame();
});

$("position").addEventListener("input", () => setPosition(Number($("position").value)));
$("speed").addEventListener("input", () => {
  state.speed = speedFromSlider(Number($("speed").value));
  updatePlayheadReadouts();
  scheduleFrame();
});
$("traversalDirection").addEventListener("click", () => {
  state.traversalDirection *= -1;
  updateTraversalDirection();
  announce(`Playhead direction ${state.traversalDirection > 0 ? "forward" : "reverse"}.`);
});

for (const button of $("playheadMotion").querySelectorAll("button[data-value]")) {
  button.addEventListener("click", () => {
    const nextMotionMode = button.dataset.value === "pingpong" ? "pingpong" : "loop";
    if (nextMotionMode !== state.motionMode) {
      state.continuousPosition = nextMotionMode === "pingpong"
        ? rebasePingPongPosition(state.continuousPosition, state.position)
        : rebaseContinuousPosition(
          state.continuousPosition,
          wrap01(state.continuousPosition),
          state.position,
        );
      state.motionMode = nextMotionMode;
    }
    for (const choice of $("playheadMotion").querySelectorAll("button[data-value]")) {
      setPressed(choice, choice === button);
    }
    updateTraversalDirection();
    lastEventTokens.clear();
    suppressStrikes = 2;
    announce(`${state.motionMode === "pingpong" ? "Ping-pong" : "Loop"} playhead movement selected.`);
    scheduleFrame();
  });
}

for (const button of $("playMethod").querySelectorAll("button")) {
  button.addEventListener("click", () => setPlayMethod(button.dataset.value));
}
$("removePlayhead").addEventListener("click", () => changePlayheadCount(-1));
$("addPlayhead").addEventListener("click", () => changePlayheadCount(1));
$("heads").addEventListener("input", () => {
  state.heads = Math.round(clamp(Number($("heads").value), 1, 12));
  state.headOffsets = canonicalHeadOffsets(state.heads);
  alignPointAndRadarDirections();
  updatePlayheadControls();
  invalidateGeometry();
});

for (let index = 0; index < 12; index += 1) {
  $(`headOption${index}`).addEventListener("click", () => {
    if (state.playMethod === "scan") {
      state.scanLineAxes[index] = scanAxisForHead(index) === "vertical" ? "horizontal" : "vertical";
    } else {
      const directions = directionsForMethod();
      const adjustments = directionAdjustmentsForMethod();
      const reversed = reversedShapeHeadState({
        position: state.continuousPosition,
        direction: directions[index],
        offset: phaseOffsetForHead(index),
        adjustment: adjustments[index],
      });
      directions[index] = reversed.direction;
      adjustments[index] = reversed.adjustment;
    }
    renderHeadLayout();
    lastEventTokens.clear();
    suppressStrikes = 2;
    scheduleFrame();
  });
  $(`headMarker${index}`).addEventListener("pointerdown", (event) => {
    draggingHead = { index, pointerId: event.pointerId };
    $("headLayoutTrack").setPointerCapture?.(event.pointerId);
    event.preventDefault?.();
  });
}

function headPhaseFromPointer(event) {
  const bounds = $("headLayoutTrack").getBoundingClientRect();
  return clamp((event.clientX - bounds.left) / Math.max(1, bounds.width));
}

$("headLayoutTrack").addEventListener("pointermove", (event) => {
  if (!draggingHead || draggingHead.pointerId !== event.pointerId) return;
  const offsets = sanitizeHeadOffsets(state.headOffsets, effectiveHeadCount());
  state.headOffsets = updateHeadOffset(
    offsets,
    draggingHead.index,
    headPhaseFromPointer(event),
  );
  renderHeadLayout();
  lastEventTokens.clear();
  suppressStrikes = 2;
  scheduleFrame();
});
function endHeadDrag(event) {
  if (!draggingHead || draggingHead.pointerId !== event.pointerId) return;
  draggingHead = null;
  announce("Playhead spacing changed.");
}
$("headLayoutTrack").addEventListener("pointerup", endHeadDrag);
$("headLayoutTrack").addEventListener("pointercancel", endHeadDrag);
$("resetHeadSpacing").addEventListener("click", () => {
  state.headOffsets = canonicalHeadOffsets(effectiveHeadCount());
  alignPointAndRadarDirections();
  renderHeadLayout();
  invalidateGeometry();
  announce("Playheads reset to equal spacing.");
});

$("rotation").addEventListener("input", () => setRotationAngle(Number($("rotation").value)));
$("resetRotation").addEventListener("click", () => setRotationAngle(0, true));
$("rotationPlayButton").addEventListener("click", () => setRotationPlaying(!state.autoRotate));
$("rotationSpeed").addEventListener("input", () => {
  state.rotationSpeed = Number($("rotationSpeed").value);
  $("rotationSpeedOut").textContent = `${state.rotationSpeed.toFixed(2)} rev/s`;
});
$("rotationDirection").addEventListener("click", () => {
  state.rotationDirection *= -1;
  const clockwise = state.rotationDirection > 0;
  $("rotationDirectionGlyph").textContent = clockwise ? "→" : "←";
  $("rotationDirectionText").textContent = clockwise ? "CW" : "CCW";
  $("rotationDirection").setAttribute("aria-label", `Rotation direction: ${clockwise ? "clockwise" : "counterclockwise"}`);
});
for (const button of $("rotationMotion").querySelectorAll("button[data-value]")) {
  button.addEventListener("click", () => {
    state.rotationMotionMode = button.dataset.value === "pingpong" ? "pingpong" : "loop";
    state.continuousRotation = shapeRotationTravelForAngle(
      state.rotation,
      state.rotationMotionMode,
    );
    for (const choice of $("rotationMotion").querySelectorAll("button[data-value]")) {
      setPressed(choice, choice === button);
    }
    scheduleFrame();
  });
}

$("sides").addEventListener("input", () => {
  state.sides = Math.round(clamp(Number($("sides").value), 1, 32));
  syncFormTopology();
});
for (const button of $("closedShapeType").querySelectorAll("button")) {
  button.addEventListener("click", () => {
    state.closedShapeType = button.dataset.value === "star" ? "star" : "polygon";
    syncFormTopology();
    announce(`${state.closedShapeType === "star" ? "Star" : "Polygon"} contour selected.`);
  });
}
for (const [id, key, formatter] of [
  ["starDepth", "starDepth", (value) => `${Math.round(value * 100)}%`],
  ["curvature", "curvature", (value) => Math.abs(value) < .005 ? "straight" : `${Math.round(Math.abs(value) * 100)}% ${value < 0 ? "inward" : "outward"}`],
  ["aspect", "aspect", (value) => Math.abs(value) < .005 ? "even" : `${Math.round(Math.abs(value) * 100)}% ${value < 0 ? "tall" : "wide"}`],
  ["skew", "skew", (value) => `${Math.round(value * 100)}%`],
]) {
  $(id).addEventListener("input", () => {
    state[key] = Number($(id).value);
    $(`${id}Out`).textContent = formatter(state[key]);
    invalidateGeometry();
  });
}
for (const [id, key, output, label] of [
  ["resetCurvature", "curvature", "curvatureOut", "straight"],
  ["resetAspect", "aspect", "aspectOut", "even"],
  ["resetSkew", "skew", "skewOut", "0%"],
]) {
  $(id).addEventListener("click", () => {
    state[key] = 0;
    $(key).value = "0";
    $(output).textContent = label;
    invalidateGeometry();
  });
}
$("resetForm").addEventListener("click", () => resetForm());

$("mappingMode").addEventListener("change", () => {
  state.mappingMode = $("mappingMode").value;
  lastEventTokens.clear();
  suppressStrikes = 2;
  updateSectionSummaries();
  const mode = SHAPE_DRUM_MAPPING_MODES.find(({ id }) => id === state.mappingMode);
  announce(`${mode?.label ?? "Mapping changed"}. ${mode?.description ?? ""} ${mappingOriginText()}`);
  scheduleFrame();
});
$("sideSubdivisions").addEventListener("input", () => {
  state.sideSubdivisions = sanitizeShapeSideSubdivisions($("sideSubdivisions").value);
  $("sideSubdivisions").value = String(state.sideSubdivisions);
  $("sideSubdivisionsOut").textContent = String(state.sideSubdivisions);
  $("sideSubdivisions").setAttribute(
    "aria-valuetext",
    `${state.sideSubdivisions} ${plural(state.sideSubdivisions, "subdivision")} per side`,
  );
  lastEventTokens.clear();
  suppressStrikes = 1;
  updateSectionSummaries();
  scheduleFrame();
});
$("pitchDepth").addEventListener("input", () => {
  state.pitchDepth = Number($("pitchDepth").value);
  $("pitchDepthOut").textContent = `±${state.pitchDepth} st`;
});
$("characterDepth").addEventListener("input", () => {
  state.characterDepth = Number($("characterDepth").value);
  $("characterDepthOut").textContent = `${Math.round(state.characterDepth * 100)}%`;
});
$("strikeLimit").addEventListener("input", () => {
  state.strikeLimit = Math.min(16, Math.max(
    1,
    Math.round(Number($("strikeLimit").value) || defaults.strikeLimit),
  ));
  $("strikeLimit").value = String(state.strikeLimit);
  $("strikeLimit").setAttribute(
    "aria-valuetext",
    `${state.strikeLimit} simultaneous ${plural(state.strikeLimit, "hit")} maximum`,
  );
  $("strikeLimitOut").textContent = `${state.strikeLimit} max`;
  updateHitCapStatus();
});
$("strikeLimit").addEventListener("change", () => {
  announce(`Simultaneous hit cap set to ${state.strikeLimit}.`);
});
$("output").addEventListener("input", () => {
  state.output = Number($("output").value);
  $("outputOut").textContent = `${Math.round(state.output * 100)}%`;
  if (state.audioOn) audio.setOutput(state.output);
});
$("resetShapeDrums").addEventListener("click", reset);

function pointerCanvasPoint(event) {
  const bounds = canvas.getBoundingClientRect();
  return {
    x: (event.clientX - bounds.left) * cssWidth / Math.max(1, bounds.width),
    y: (event.clientY - bounds.top) * cssHeight / Math.max(1, bounds.height),
  };
}

function pointerAngle(event) {
  const point = pointerCanvasPoint(event);
  return Math.atan2(point.y - cssHeight / 2, point.x - cssWidth / 2);
}

canvas.addEventListener("pointerdown", (event) => {
  pointerGesture = {
    pointerId: event.pointerId,
    startAngle: pointerAngle(event),
    startRotation: state.rotation,
  };
  canvas.setPointerCapture(event.pointerId);
  canvas.focus();
});
canvas.addEventListener("pointermove", (event) => {
  if (!pointerGesture || pointerGesture.pointerId !== event.pointerId) return;
  const delta = Math.atan2(
    Math.sin(pointerAngle(event) - pointerGesture.startAngle),
    Math.cos(pointerAngle(event) - pointerGesture.startAngle),
  );
  setRotationAngle(pointerGesture.startRotation + delta * 180 / Math.PI);
});
function endCanvasPointer(event) {
  if (!pointerGesture || pointerGesture.pointerId !== event.pointerId) return;
  pointerGesture = null;
}
canvas.addEventListener("pointerup", endCanvasPointer);
canvas.addEventListener("pointercancel", endCanvasPointer);

window.addEventListener("keydown", (event) => {
  if (/^(INPUT|SELECT|TEXTAREA|BUTTON|SUMMARY|A)$/.test(event.target?.tagName || "")) return;
  const key = String(event.key || "").toLowerCase();
  const voiceIndex = voices.findIndex((voice) => voice.key === key);
  if (voiceIndex >= 0) {
    event.preventDefault();
    void previewVoice(voiceIndex);
    return;
  }
  if (event.code === "Space" || event.key === " ") {
    event.preventDefault();
    $("playButton").click();
  } else if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
    event.preventDefault();
    setPosition(state.position + (event.key === "ArrowLeft" ? -.01 : .01));
  }
});

document.addEventListener("visibilitychange", () => {
  if (document.hidden) setAudioState(false);
});

function bridgeRange(id, value) {
  const input = $(id);
  if (!input || !Number.isFinite(Number(value))) return;
  input.value = String(value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

const SHARED_MAPPING_FROM_SHAPE = Object.freeze({
  "contour-corner": "feature",
  "position-grid": "position",
  "incidence-playhead": "incidence",
});
const SHAPE_MAPPING_FROM_SHARED = Object.freeze({
  feature: "contour-corner",
  position: "position-grid",
  incidence: "incidence-playhead",
});

function shapeDimensionState() {
  return {
    shapeType: state.shapeType,
    sides: state.sides,
    closedShapeType: state.closedShapeType,
    starDepth: state.starDepth,
    curvature: state.curvature,
    aspect: state.aspect,
    skew: state.skew,
    playMethod: state.playMethod,
    heads: state.heads,
    headOffsets: state.headOffsets.slice(0, 12),
    scanLineAxes: state.scanLineAxes.slice(0, 12),
    traceHeadDirections: state.traceHeadDirections.slice(0, 12),
    radialHeadDirections: state.radialHeadDirections.slice(0, 12),
    traceHeadDirectionAdjustments: state.traceHeadDirectionAdjustments.slice(0, 12),
    radialHeadDirectionAdjustments: state.radialHeadDirectionAdjustments.slice(0, 12),
    rotation: state.rotation,
    continuousRotation: state.continuousRotation,
    rotationMotionMode: state.rotationMotionMode,
    autoRotate: state.autoRotate,
    rotationSpeed: state.rotationSpeed,
    rotationDirection: state.rotationDirection,
  };
}

function applyShapeDimensionState(dimension = {}) {
  if (!dimension || !Object.keys(dimension).length) return;
  if (Number.isFinite(Number(dimension.sides))) {
    state.sides = Math.round(clamp(dimension.sides, 1, 32));
  }
  state.closedShapeType = dimension.closedShapeType === "star" ? "star" : "polygon";
  if (Number.isFinite(Number(dimension.starDepth))) {
    state.starDepth = clamp(dimension.starDepth, 0.05, 0.82);
  }
  $("sides").value = String(state.sides);
  $("starDepth").value = String(state.starDepth);
  syncFormTopology();
  bridgeRange("starDepth", state.starDepth);
  bridgeRange("curvature", dimension.curvature);
  bridgeRange("aspect", dimension.aspect);
  bridgeRange("skew", dimension.skew);

  setPlayMethod(dimension.playMethod, false);
  if (Number.isFinite(Number(dimension.heads))) {
    state.heads = Math.round(clamp(dimension.heads, 1, 12));
  }
  state.headOffsets = sanitizeHeadOffsets(
    Array.isArray(dimension.headOffsets) ? dimension.headOffsets : state.headOffsets,
    state.heads,
  );
  state.scanLineAxes = Array.from({ length: 12 }, (_, index) => (
    dimension.scanLineAxes?.[index] === "horizontal" ? "horizontal" : "vertical"
  ));
  for (const key of ["traceHeadDirections", "radialHeadDirections"]) {
    state[key] = Array.from({ length: 12 }, (_, index) => (
      Number(dimension[key]?.[index]) < 0 ? -1 : 1
    ));
  }
  for (const key of ["traceHeadDirectionAdjustments", "radialHeadDirectionAdjustments"]) {
    state[key] = Array.from({ length: 12 }, (_, index) => (
      Number.isFinite(Number(dimension[key]?.[index])) ? Number(dimension[key][index]) : 0
    ));
  }

  state.rotationMotionMode = dimension.rotationMotionMode === "pingpong" ? "pingpong" : "loop";
  if (Number.isFinite(Number(dimension.rotation))) setRotationAngle(dimension.rotation);
  if (Number.isFinite(Number(dimension.continuousRotation))) {
    state.continuousRotation = Number(dimension.continuousRotation);
  }
  bridgeRange("rotationSpeed", dimension.rotationSpeed);
  state.rotationDirection = dimension.rotationDirection < 0 ? -1 : 1;
  const clockwise = state.rotationDirection > 0;
  $("rotationDirectionGlyph").textContent = clockwise ? "→" : "←";
  $("rotationDirectionText").textContent = clockwise ? "CW" : "CCW";
  $("rotationDirection").setAttribute("aria-label", `Rotation direction: ${clockwise ? "clockwise" : "counterclockwise"}`);
  state.autoRotate = Boolean(dimension.autoRotate);
  setPressed($("rotationPlayButton"), state.autoRotate);
  $("rotationPlayButton").setAttribute("aria-label", state.autoRotate ? "Pause rotation" : "Start rotation");
  for (const button of $("rotationMotion").querySelectorAll("button[data-value]")) {
    setPressed(button, button.dataset.value === state.rotationMotionMode);
  }
  updatePlayheadControls();
}

function suppressShapeDrumContacts() {
  lastEventTokens.clear();
  lastStrikeTimes.clear();
  suppressStrikes = Math.max(suppressStrikes, 2);
}

function resetShapesBank(bank) {
  if (bank === "form") {
    resetForm();
    suppressShapeDrumContacts();
    return true;
  }

  if (bank === "play") {
    Object.assign(state, {
      playMethod: defaults.playMethod,
      heads: defaults.heads,
      motionMode: defaults.motionMode,
      position: defaults.position,
      continuousPosition: defaults.position,
      speed: defaults.speed,
      traversalDirection: defaults.traversalDirection,
      playing: false,
      headOffsets: [0],
      scanLineAxes: Array(12).fill("vertical"),
      traceHeadDirections: Array(12).fill(1),
      radialHeadDirections: Array(12).fill(1),
      traceHeadDirectionAdjustments: Array(12).fill(0),
      radialHeadDirectionAdjustments: Array(12).fill(0),
    });
    $("position").value = String(state.position);
    $("speed").value = String(sliderFromSpeed(state.speed));
    setPressed($("playButton"), false);
    $("playButton").setAttribute("aria-label", "Play playhead");
    for (const button of $("playheadMotion").querySelectorAll("button[data-value]")) {
      setPressed(button, button.dataset.value === state.motionMode);
    }
    updatePlayheadControls();
    updatePlayheadReadouts();
    updateSectionSummaries();
    suppressShapeDrumContacts();
    lastFrameTime = performance.now();
    announce("Play controls reset.");
    invalidateGeometry();
    return true;
  }

  if (bank === "rotation") {
    Object.assign(state, {
      rotation: defaults.rotation,
      continuousRotation: 0,
      rotationSpeed: defaults.rotationSpeed,
      rotationDirection: defaults.rotationDirection,
      rotationMotionMode: defaults.rotationMotionMode,
      autoRotate: false,
    });
    $("rotationSpeed").value = String(state.rotationSpeed);
    $("rotationSpeedOut").textContent = `${state.rotationSpeed.toFixed(2)} rev/s`;
    setRotationAngle(state.rotation);
    setPressed($("rotationPlayButton"), false);
    $("rotationPlayButton").setAttribute("aria-label", "Start rotation");
    for (const button of $("rotationMotion").querySelectorAll("button[data-value]")) {
      setPressed(button, button.dataset.value === state.rotationMotionMode);
    }
    $("rotationDirectionGlyph").textContent = "→";
    $("rotationDirectionText").textContent = "CW";
    $("rotationDirection").setAttribute("aria-label", "Rotation direction: clockwise");
    updateSectionSummaries();
    suppressShapeDrumContacts();
    lastFrameTime = performance.now();
    announce("Rotation controls reset.");
    invalidateGeometry();
    return true;
  }

  if (bank === "mapping") {
    state.mappingMode = defaults.mappingMode;
    $("mappingMode").value = state.mappingMode;
    for (const key of ["pitchDepth", "characterDepth", "strikeLimit"]) {
      bridgeRange(key, defaults[key]);
    }
    updateSectionSummaries();
    updateHitCapStatus();
    suppressShapeDrumContacts();
    announce("Drum mapping reset.");
    scheduleFrame();
    return true;
  }

  return false;
}

installShapesNativeBridge({
  geometry: "shape",
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
    topology: {
      sides: state.sides,
      kind: state.sides === 1
        ? "circle"
        : state.sides === 2 ? "line" : state.closedShapeType,
      starDepth: state.starDepth,
      lift: state.sides === 1 ? "round" : "prism",
    },
    dimension: shapeDimensionState(),
    drums: {
      mappingFamily: SHARED_MAPPING_FROM_SHAPE[state.mappingMode] ?? "feature",
      subdivisions: state.sideSubdivisions,
      pitchDepth: state.pitchDepth,
      characterDepth: state.characterDepth,
      strikeLimit: state.strikeLimit,
    },
  }),
  applyState: (snapshot = {}) => {
    shapesHostParked = false;
    const playback = snapshot.playback ?? {};
    const profile = snapshot.topology ?? {};
    const drums = snapshot.drums ?? {};
    applyShapeDimensionState(snapshot.dimension ?? {});
    if (profile.lift !== "local" && Number.isFinite(Number(profile.sides))) {
      state.sides = Math.round(clamp(profile.sides, 1, 32));
      state.closedShapeType = profile.kind === "star" ? "star" : "polygon";
      state.starDepth = clamp(profile.starDepth ?? state.starDepth, 0.05, 0.82);
      $("sides").value = String(state.sides);
      $("starDepth").value = String(state.starDepth);
      syncFormTopology();
      bridgeRange("starDepth", state.starDepth);
    }
    state.motionMode = playback.motionMode === "pingpong" ? "pingpong" : "loop";
    for (const button of $("playheadMotion").querySelectorAll("button[data-value]")) {
      setPressed(button, button.dataset.value === state.motionMode);
    }
    state.speed = clamp(playback.speed ?? state.speed, 0, SPEED_MAX);
    $("speed").value = String(sliderFromSpeed(state.speed));
    state.continuousPosition = Number.isFinite(playback.continuousPosition)
      ? playback.continuousPosition
      : clamp(playback.position ?? state.position);
    state.position = state.motionMode === "pingpong"
      ? pingPong01(state.continuousPosition)
      : wrap01(state.continuousPosition);
    $("position").value = String(state.position);
    state.traversalDirection = playback.direction < 0 ? -1 : 1;
    state.playing = Boolean(playback.playing);
    setPressed($("playButton"), state.playing);
    $("playButton").setAttribute("aria-label", state.playing ? "Pause playhead" : "Play playhead");
    const mappingMode = SHAPE_MAPPING_FROM_SHARED[drums.mappingFamily];
    if (mappingMode && $("mappingMode").querySelector(`option[value="${mappingMode}"]`)) {
      state.mappingMode = mappingMode;
      $("mappingMode").value = mappingMode;
    }
    bridgeRange("sideSubdivisions", drums.subdivisions);
    bridgeRange("pitchDepth", drums.pitchDepth);
    bridgeRange("characterDepth", drums.characterDepth);
    bridgeRange("strikeLimit", drums.strikeLimit);
    bridgeRange("output", snapshot.audio?.level);
    updateTraversalDirection();
    updateSectionSummaries();
    updatePlayheadReadouts();
    suppressShapeDrumContacts();
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
    suppressShapeDrumContacts();
    scheduleFrame();
  },
  disableAudio: () => setAudioState(false),
  resetBank: resetShapesBank,
});

window.addEventListener("pageshow", scheduleFrame);
window.addEventListener("pagehide", () => {
  if (audio.context && audio.context.state !== "closed") void audio.context.close();
});

populateMappingModes();
renderDrumMap();
new ResizeObserver(resizeCanvas).observe(stageWrap);
reset();

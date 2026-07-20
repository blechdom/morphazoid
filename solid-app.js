import {
  VoicePool,
  clamp,
  cornerAttackSeconds,
  cornerDecaySeconds,
  normalizeStrikeGains,
  pitch01ToFrequency,
  sineCornerEnvelopeGain,
  synthParametersForMode,
} from "./src/audio.js";
import {
  buildSolid,
  deformSolid,
  planeBasis,
  planeIntersections,
  planeNormal,
  planeOffsetForPhase,
  projectPoint3,
  rotatePoint3,
} from "./src/solid.js";

const $ = (id) => document.getElementById(id);
const TAU = Math.PI * 2;
const pool = new VoicePool(32);
const canvas = $("stage");
const stageWrap = $("stageWrap");
const context = canvas.getContext("2d", { desynchronized: true });

const state = {
  solidType: "cube",
  position: 0.5,
  continuousPosition: 0.5,
  speed: 0.12,
  direction: 1,
  playing: false,
  rotationX: -18,
  rotationY: 28,
  rotationZ: 0,
  rotationXPlaying: false,
  rotationYPlaying: false,
  rotationZPlaying: false,
  rotationXSpeed: 0.03,
  rotationYSpeed: 0.08,
  rotationZSpeed: 0.02,
  planeYaw: 0,
  planePitch: 18,
  planeYawPlaying: false,
  planePitchPlaying: false,
  planeYawSpeed: 0.04,
  planePitchSpeed: 0.03,
  formScaleX: 1,
  formScaleY: 1,
  formScaleZ: 1,
  formSkewX: 0,
  formSkewZ: 0,
  audio: false,
  soundMode: "sine",
  level: 0.65,
  baseFrequency: 110,
  pitchRange: 3,
  fmIndex: 3,
  fmRatio: 2,
};

let cssWidth = 1;
let cssHeight = 1;
let pixelRatio = 1;
let scheduledFrame = 0;
let lastFrameTime = performance.now();
let lastAudioTime = null;
let previousVertexSigns = null;
let pointer = null;

function normalizeDegrees(value) {
  return ((value + 180) % 360 + 360) % 360 - 180;
}

function announce(message) {
  $("liveStatus").textContent = message;
}

function scheduleFrame() {
  if (!scheduledFrame) scheduledFrame = requestAnimationFrame(frame);
}

function setPressed(element, pressed) {
  element.setAttribute("aria-pressed", String(Boolean(pressed)));
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
  scheduleFrame();
}

new ResizeObserver(resizeCanvas).observe(stageWrap);
resizeCanvas();

function bindRange(id, key, formatter, afterChange) {
  const input = $(id);
  const output = $(`${id}Out`);
  input.value = String(state[key]);
  const update = () => {
    if (output) output.textContent = formatter(state[key]);
  };
  input.addEventListener("input", () => {
    state[key] = Number(input.value);
    update();
    afterChange?.();
    scheduleFrame();
  });
  update();
}

bindRange("position", "position", (value) => `${((value * 2 - 1) * 100).toFixed(1)}%`, () => {
  state.continuousPosition += state.position - (((state.continuousPosition % 1) + 1) % 1);
  previousVertexSigns = null;
});
bindRange("speed", "speed", (value) => `${value.toFixed(2)} cyc/s`);
bindRange("level", "level", (value) => `${Math.round(value * 100)}%`, () => pool.setLevel(state.level));
bindRange("planeYaw", "planeYaw", (value) => `${Math.round(value)}°`, () => { previousVertexSigns = null; });
bindRange("planePitch", "planePitch", (value) => `${Math.round(value)}°`, () => { previousVertexSigns = null; });
bindRange("rotationX", "rotationX", (value) => `${Math.round(value)}°`, () => { previousVertexSigns = null; });
bindRange("rotationY", "rotationY", (value) => `${Math.round(value)}°`, () => { previousVertexSigns = null; });
bindRange("rotationZ", "rotationZ", (value) => `${Math.round(value)}°`, () => { previousVertexSigns = null; });
for (const key of [
  "rotationXSpeed", "rotationYSpeed", "rotationZSpeed",
  "planeYawSpeed", "planePitchSpeed",
]) {
  bindRange(key, key, (value) => `${value >= 0 ? "+" : ""}${value.toFixed(2)} rev/s`);
}
for (const key of ["formScaleX", "formScaleY", "formScaleZ"]) {
  bindRange(key, key, (value) => `${value.toFixed(2)}×`, () => { previousVertexSigns = null; });
}
for (const key of ["formSkewX", "formSkewZ"]) {
  bindRange(key, key, (value) => `${Math.round(value * 100)}%`, () => { previousVertexSigns = null; });
}
bindRange("baseFrequency", "baseFrequency", (value) => `${Math.round(value)} Hz`);
bindRange("pitchRange", "pitchRange", (value) => `${value.toFixed(2)} oct`);
bindRange("fmIndex", "fmIndex", (value) => `${value.toFixed(2)} max`);
bindRange("fmRatio", "fmRatio", (value) => `${value.toFixed(2)} : 1`);

$("solidType").addEventListener("change", (event) => {
  state.solidType = event.currentTarget.value;
  $("formSummary").textContent = state.solidType;
  previousVertexSigns = null;
  announce(`${state.solidType} wireframe selected.`);
  scheduleFrame();
});

$("resetSolidForm").addEventListener("click", () => {
  for (const key of ["formScaleX", "formScaleY", "formScaleZ"]) state[key] = 1;
  for (const key of ["formSkewX", "formSkewZ"]) state[key] = 0;
  for (const key of ["formScaleX", "formScaleY", "formScaleZ", "formSkewX", "formSkewZ"]) {
    $(key).value = String(state[key]);
    $(`${key}Out`).textContent = key.startsWith("formScale")
      ? `${state[key].toFixed(2)}×`
      : `${Math.round(state[key] * 100)}%`;
  }
  previousVertexSigns = null;
  announce("Solid proportions reset.");
  scheduleFrame();
});

$("soundMode").addEventListener("change", (event) => {
  state.soundMode = event.currentTarget.value;
  pool.silence();
  $("soundSummary").textContent = state.soundMode.toUpperCase();
  $("fmControls").hidden = !["fm", "pm"].includes(state.soundMode);
  previousVertexSigns = null;
  scheduleFrame();
});

function paintTransport() {
  setPressed($("playButton"), state.playing);
  const surfaceAxes = [
    state.planeYawPlaying ? "yaw" : "",
    state.planePitchPlaying ? "pitch" : "",
  ].filter(Boolean);
  $("playSummary").textContent = state.playing || surfaceAxes.length
    ? `plane · ${[state.playing ? "position" : "", ...surfaceAxes].filter(Boolean).join("+")}`
    : "plane · paused";
}

const AXIS_MOTIONS = [
  { key: "rotationXPlaying", button: "rotationXPlay", label: "X rotation" },
  { key: "rotationYPlaying", button: "rotationYPlay", label: "Y rotation" },
  { key: "rotationZPlaying", button: "rotationZPlay", label: "Z rotation" },
  { key: "planeYawPlaying", button: "planeYawPlay", label: "surface yaw" },
  { key: "planePitchPlaying", button: "planePitchPlay", label: "surface pitch" },
];

function rotationIsMoving() {
  return state.rotationXPlaying || state.rotationYPlaying || state.rotationZPlaying;
}

function motionIsActive() {
  return state.playing || rotationIsMoving() || state.planeYawPlaying || state.planePitchPlaying;
}

function resetClocks() {
  lastFrameTime = performance.now();
  lastAudioTime = pool.context?.currentTime ?? null;
}

function paintMotionControls() {
  for (const motion of AXIS_MOTIONS) {
    const button = $(motion.button);
    setPressed(button, state[motion.key]);
    button.setAttribute("aria-label", `${state[motion.key] ? "Pause" : "Play"} ${motion.label}`);
    button.querySelector("span").textContent = state[motion.key] ? "Ⅱ" : "▶";
  }
  const axes = [
    state.rotationXPlaying ? "X" : "",
    state.rotationYPlaying ? "Y" : "",
    state.rotationZPlaying ? "Z" : "",
  ].filter(Boolean);
  $("rotationSummary").textContent = axes.length ? axes.join("+") : "paused";
  paintTransport();
}

for (const motion of AXIS_MOTIONS) {
  $(motion.button).addEventListener("click", () => {
    state[motion.key] = !state[motion.key];
    previousVertexSigns = null;
    resetClocks();
    paintMotionControls();
    if (!motionIsActive()) pool.silence();
    announce(`${motion.label} ${state[motion.key] ? "playing" : "paused"}.`);
    scheduleFrame();
  });
}

$("playButton").addEventListener("click", () => {
  state.playing = !state.playing;
  resetClocks();
  paintTransport();
  if (!motionIsActive()) pool.silence();
  announce(state.playing ? "Surface playing." : "Surface paused.");
  scheduleFrame();
});

$("directionButton").addEventListener("click", () => {
  state.direction *= -1;
  $("directionButton").textContent = `Direction · ${state.direction > 0 ? "forward" : "reverse"}`;
  announce(`Surface direction ${state.direction > 0 ? "forward" : "reverse"}.`);
  scheduleFrame();
});

async function toggleAudio() {
  $("audioError").hidden = true;
  if (state.audio) {
    state.audio = false;
    pool.disable();
  } else {
    try {
      $("audioState").textContent = "starting…";
      await pool.enable();
      pool.setLevel(state.level);
      state.audio = true;
    } catch (error) {
      $("audioError").textContent = error instanceof Error ? error.message : "Web Audio could not start.";
      $("audioError").hidden = false;
    }
  }
  setPressed($("audioButton"), state.audio);
  $("audioState").textContent = state.audio ? "on" : "off";
  scheduleFrame();
}

$("audioButton").addEventListener("click", toggleAudio);

function transformedSolid(rotation = currentRotation()) {
  const solid = deformSolid(buildSolid(state.solidType), {
    scaleX: state.formScaleX,
    scaleY: state.formScaleY,
    scaleZ: state.formScaleZ,
    skewX: state.formSkewX,
    skewZ: state.formSkewZ,
  });
  return {
    ...solid,
    vertices: solid.vertices.map((point) => rotatePoint3(point, rotation)),
  };
}

function currentRotation() {
  return { x: state.rotationX, y: state.rotationY, z: state.rotationZ };
}

function currentPlane(
  phase = state.continuousPosition,
  yaw = state.planeYaw,
  pitch = state.planePitch,
  solid = null,
) {
  const normal = planeNormal(yaw, pitch);
  const radius = solid?.vertices?.length
    ? Math.max(...solid.vertices.map((point) => Math.abs(
      normal.x * point.x + normal.y * point.y + normal.z * point.z
    ))) + 0.04
    : 1.05;
  return { normal, offset: planeOffsetForPhase(phase, radius) };
}

function projectionTransform() {
  const scale = Math.min(cssWidth, cssHeight) * 0.34;
  return {
    x: (value) => cssWidth * 0.5 + value * scale,
    y: (value) => cssHeight * 0.5 - value * scale,
  };
}

function projected(point, transform) {
  const result = projectPoint3(point);
  return { ...result, canvasX: transform.x(result.x), canvasY: transform.y(result.y) };
}

function drawPlane(plane, transform) {
  const { u, v } = planeBasis(plane.normal);
  const center = {
    x: plane.normal.x * plane.offset,
    y: plane.normal.y * plane.offset,
    z: plane.normal.z * plane.offset,
  };
  const size = 1.18;
  const corners = [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([a, b]) => projected({
    x: center.x + (u.x * a + v.x * b) * size,
    y: center.y + (u.y * a + v.y * b) * size,
    z: center.z + (u.z * a + v.z * b) * size,
  }, transform));
  context.beginPath();
  corners.forEach((point, index) => index
    ? context.lineTo(point.canvasX, point.canvasY)
    : context.moveTo(point.canvasX, point.canvasY));
  context.closePath();
  context.fillStyle = "rgba(125,180,255,.055)";
  context.fill();
  context.strokeStyle = "rgba(125,180,255,.38)";
  context.lineWidth = 1;
  context.setLineDash([4, 6]);
  context.stroke();
  context.setLineDash([]);
}

function drawScene(solid, plane, contacts) {
  context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
  context.clearRect(0, 0, cssWidth, cssHeight);
  const transform = projectionTransform();
  drawPlane(plane, transform);

  const edges = solid.edges.map((item, edgeIndex) => ({
    item,
    edgeIndex,
    depth: (solid.vertices[item.a].z + solid.vertices[item.b].z) * 0.5,
  })).sort((a, b) => a.depth - b.depth);
  for (const { item, depth } of edges) {
    const a = projected(solid.vertices[item.a], transform);
    const b = projected(solid.vertices[item.b], transform);
    const alpha = clamp(0.35 + (depth + 1) * 0.22, 0.22, 0.86);
    context.beginPath();
    context.moveTo(a.canvasX, a.canvasY);
    context.lineTo(b.canvasX, b.canvasY);
    context.strokeStyle = `rgba(232,196,107,${alpha})`;
    context.lineWidth = 1.2;
    context.stroke();
  }

  for (const vertex of solid.vertices) {
    const point = projected(vertex, transform);
    context.beginPath();
    context.arc(point.canvasX, point.canvasY, 2.6 * point.scale, 0, TAU);
    context.fillStyle = "#07090b";
    context.fill();
    context.strokeStyle = "rgba(232,196,107,.66)";
    context.stroke();
  }

  for (const contact of contacts) {
    const point = projected(contact, transform);
    context.save();
    context.shadowColor = "#7db4ff";
    context.shadowBlur = 16;
    context.beginPath();
    context.arc(point.canvasX, point.canvasY, 5, 0, TAU);
    context.fillStyle = "#fff3d6";
    context.fill();
    context.restore();
  }
}

function voiceForContact(contact, index, phase = state.continuousPosition) {
  const pitch = clamp((contact.y + 1) * 0.5, 0, 1);
  const drive = clamp((contact.z + 1) * 0.5, 0, 1);
  const synth = synthParametersForMode(state.soundMode, drive, {
    fmIndex: state.fmIndex,
    fmRatio: state.fmRatio,
    pmIndex: state.fmIndex * 0.7,
    pmRatio: state.fmRatio,
    shepardRate: state.playing ? state.speed * state.direction : 0,
    shepardWidth: 4,
  });
  return {
    key: `solid:${contact.edgeIndex ?? index}`,
    frequency: pitch01ToFrequency(pitch, state.baseFrequency, state.pitchRange),
    gain: sineCornerEnvelopeGain(contact.cornerStrength ?? 0, 0.25, 0.8, 350, 200),
    pan: clamp(contact.x, -1, 1),
    waveform: "sine",
    ...synth,
  };
}

function emitVertexStrikes(solid, plane) {
  const signs = solid.vertices.map((point) => (
    plane.normal.x * point.x + plane.normal.y * point.y + plane.normal.z * point.z - plane.offset
  ));
  if (state.audio && state.soundMode === "percussion" && previousVertexSigns) {
    const intents = [];
    signs.forEach((sign, index) => {
      const before = previousVertexSigns[index];
      if (before === undefined || before * sign > 0) return;
      const point = solid.vertices[index];
      intents.push({
        key: `solid:vertex:${index}`,
        frequency: pitch01ToFrequency(clamp((point.y + 1) * 0.5, 0, 1), state.baseFrequency, state.pitchRange),
        gain: 0.42,
        pan: clamp(point.x, -1, 1),
        waveform: "sine",
      });
    });
    const normalized = normalizeStrikeGains(intents, 0.78);
    normalized.forEach((spec) => pool.strike(spec, {
      attackSeconds: cornerAttackSeconds(3),
      decaySeconds: cornerDecaySeconds(110),
    }));
  }
  previousVertexSigns = signs;
}

function transportDelta(now) {
  const performanceDelta = Math.max(0, (now - lastFrameTime) / 1000);
  lastFrameTime = now;
  const audioTime = state.audio && pool.context?.state === "running" ? pool.context.currentTime : null;
  const audioDelta = Number.isFinite(audioTime) && Number.isFinite(lastAudioTime) && audioTime >= lastAudioTime
    ? audioTime - lastAudioTime
    : 0;
  lastAudioTime = Number.isFinite(audioTime) ? audioTime : null;
  return Math.min(1, audioDelta > 1e-6 ? audioDelta : performanceDelta);
}

function frame(now) {
  scheduledFrame = 0;
  const delta = transportDelta(now);
  if (state.playing) {
    state.continuousPosition += state.direction * state.speed * delta;
    state.position = ((state.continuousPosition % 1) + 1) % 1;
  }
  for (const axis of ["X", "Y", "Z"]) {
    if (!state[`rotation${axis}Playing`]) continue;
    state[`rotation${axis}`] = normalizeDegrees(
      state[`rotation${axis}`] + state[`rotation${axis}Speed`] * 360 * delta,
    );
  }
  if (state.planeYawPlaying) {
    state.planeYaw = normalizeDegrees(state.planeYaw + state.planeYawSpeed * 360 * delta);
  }
  if (state.planePitchPlaying) {
    state.planePitch = normalizeDegrees(state.planePitch + state.planePitchSpeed * 360 * delta);
  }

  const solid = transformedSolid();
  const plane = currentPlane(state.continuousPosition, state.planeYaw, state.planePitch, solid);
  const contacts = planeIntersections(solid, plane.normal, plane.offset);
  drawScene(solid, plane, contacts);
  const moving = motionIsActive();
  if (moving) emitVertexStrikes(solid, plane);

  const continuous = state.soundMode !== "percussion";
  const voices = continuous ? contacts.map(voiceForContact) : [];
  if (state.audio) {
    if (continuous && moving) {
      const futurePhase = state.continuousPosition + (state.playing
        ? state.direction * state.speed * 0.075
        : 0);
      const futureRotation = {
        x: state.rotationX + (state.rotationXPlaying ? state.rotationXSpeed * 360 * 0.075 : 0),
        y: state.rotationY + (state.rotationYPlaying ? state.rotationYSpeed * 360 * 0.075 : 0),
        z: state.rotationZ + (state.rotationZPlaying ? state.rotationZSpeed * 360 * 0.075 : 0),
      };
      const futureSolid = transformedSolid(futureRotation);
      const futurePlane = currentPlane(
        futurePhase,
        state.planeYaw + (state.planeYawPlaying ? state.planeYawSpeed * 360 * 0.075 : 0),
        state.planePitch + (state.planePitchPlaying ? state.planePitchSpeed * 360 * 0.075 : 0),
        futureSolid,
      );
      const futureContacts = planeIntersections(futureSolid, futurePlane.normal, futurePlane.offset);
      pool.setVoiceTrajectory(voices, futureContacts.map((contact, index) => (
        voiceForContact(contact, index, futurePhase)
      )), 0.075);
    } else pool.setVoices([]);
  }

  $("position").value = String(state.position);
  $("positionOut").textContent = `${((state.position * 2 - 1) * 100).toFixed(1)}%`;
  for (const axis of ["X", "Y", "Z"]) {
    $(`rotation${axis}`).value = String(state[`rotation${axis}`]);
    $(`rotation${axis}Out`).textContent = `${Math.round(state[`rotation${axis}`])}°`;
  }
  $("planeYaw").value = String(state.planeYaw);
  $("planeYawOut").textContent = `${Math.round(state.planeYaw)}°`;
  $("planePitch").value = String(state.planePitch);
  $("planePitchOut").textContent = `${Math.round(state.planePitch)}°`;
  $("stageReadout").textContent = `${state.solidType.toUpperCase()} · ${contacts.length} CONTACT${contacts.length === 1 ? "" : "S"} · ${state.audio ? `${moving && continuous ? Math.min(voices.length, 32) : pool.activeStrikeCount} VOICES` : "AUDIO OFF"}`;

  if (moving) scheduleFrame();
}

canvas.addEventListener("pointerdown", (event) => {
  state.rotationXPlaying = false;
  state.rotationYPlaying = false;
  paintMotionControls();
  pointer = { id: event.pointerId, x: event.clientX, y: event.clientY, rx: state.rotationX, ry: state.rotationY };
  canvas.setPointerCapture(event.pointerId);
});
canvas.addEventListener("pointermove", (event) => {
  if (!pointer || pointer.id !== event.pointerId) return;
  state.rotationY = normalizeDegrees(pointer.ry + (event.clientX - pointer.x) * 0.45);
  state.rotationX = normalizeDegrees(pointer.rx - (event.clientY - pointer.y) * 0.45);
  previousVertexSigns = null;
  scheduleFrame();
});
const endPointer = (event) => { if (pointer?.id === event.pointerId) pointer = null; };
canvas.addEventListener("pointerup", endPointer);
canvas.addEventListener("pointercancel", endPointer);

document.addEventListener("visibilitychange", () => {
  if (document.hidden) pool.silence();
  else scheduleFrame();
});
window.addEventListener("pagehide", (event) => {
  if (event.persisted) pool.disable();
  else void pool.close();
});

paintTransport();
paintMotionControls();
scheduleFrame();

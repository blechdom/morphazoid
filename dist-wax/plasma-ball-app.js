import {
  VoicePool,
  normalizeVoiceGains,
  pitch01ToFrequency,
} from "./src/audio.js";
import {
  PLASMA_DEFAULTS,
  clamp,
  createPlasmaBolts,
  plasmaBoltPath,
  plasmaVoiceSpecs,
  stepPlasmaBolts,
  wrapAngle,
} from "./src/plasma-ball.js";

const $ = (id) => document.getElementById(id);
const TAU = Math.PI * 2;
const MAX_VOICES = 18;
const VISUAL_FRAME_INTERVAL = 1_000 / 30;
const AUDIO_FRAME_INTERVAL = 1_000 / 30;
const MAX_STATIC_STRIKES_PER_FRAME = 3;
const canvas = $("stage");
const stageWrap = $("stageWrap");
const context = canvas.getContext("2d", { alpha: true, desynchronized: true });
const pool = new VoicePool(MAX_VOICES);
const reducedMotionQuery = globalThis.matchMedia?.("(prefers-reduced-motion: reduce)");

const state = {
  ...PLASMA_DEFAULTS,
  bolts: createPlasmaBolts(PLASMA_DEFAULTS.boltCount, 19),
  playing: true,
  audioOn: false,
  audioStarting: false,
  reducedMotion: reducedMotionQuery?.matches ?? false,
  pointer: { x: 0, y: 0, z: 1, active: false, pressed: false, type: "mouse" },
  keyboardAngle: 0,
  time: 0,
  surge: 0,
};

let cssWidth = 1;
let cssHeight = 1;
let pixelRatio = 1;
let frameRequest = 0;
let lastFrameAt = null;
let lastAudioAt = -Infinity;
let pageActive = true;
let layout = { centerX: 0.5, centerY: 0.5, radius: 0.4 };

function percent(value) {
  return `${Math.round(clamp(value, 0, 1) * 100)}%`;
}

function setPressed(element, pressed) {
  element.setAttribute("aria-pressed", String(Boolean(pressed)));
}

function announce(message) {
  const live = $("liveStatus");
  live.textContent = "";
  requestAnimationFrame(() => {
    live.textContent = message;
  });
}

function showAudioError(error) {
  const message = error instanceof Error ? error.message : String(error);
  $("audioError").textContent = message || "Web Audio could not start.";
  $("audioError").hidden = false;
  announce(`Audio error: ${$("audioError").textContent}`);
}

function clearAudioError() {
  $("audioError").hidden = true;
  $("audioError").textContent = "";
}

function resizeCanvas() {
  const bounds = stageWrap.getBoundingClientRect();
  cssWidth = Math.max(1, Math.round(bounds.width));
  cssHeight = Math.max(1, Math.round(bounds.height));
  pixelRatio = Math.max(1, Math.min(
    globalThis.devicePixelRatio || 1,
    1.35,
    Math.sqrt(1_250_000 / Math.max(1, cssWidth * cssHeight)),
  ));
  const width = Math.round(cssWidth * pixelRatio);
  const height = Math.round(cssHeight * pixelRatio);
  if (canvas.width !== width) canvas.width = width;
  if (canvas.height !== height) canvas.height = height;
  layout = computeLayout();
}

function computeLayout() {
  const shortStage = cssHeight < 330;
  const radius = Math.max(58, Math.min(
    cssWidth * (cssWidth < 520 ? 0.34 : 0.37),
    cssHeight * (shortStage ? 0.36 : 0.405),
  ));
  return {
    centerX: cssWidth * (cssWidth < 520 ? 0.54 : 0.515),
    centerY: cssHeight * (shortStage ? 0.52 : 0.525),
    radius,
  };
}

function requestFrame() {
  if (!frameRequest && pageActive) frameRequest = requestAnimationFrame(frame);
}

function pointerForPhysics() {
  return {
    x: state.pointer.x,
    y: state.pointer.y,
    z: state.pointer.z,
    active: state.pointer.active,
    pressed: state.pointer.pressed,
  };
}

function continuousVoices({ force = false } = {}) {
  if (!state.playing && !force) return [];
  const geometric = plasmaVoiceSpecs(state.bolts, {
    pointer: pointerForPhysics(),
    radius: 1,
    waveform: "triangle",
  });
  const voices = geometric.map((voice, index) => ({
    ...voice,
    frequency: pitch01ToFrequency(voice.pitch01, state.baseFrequency, state.pitchRange),
    gain: voice.gain * (0.5 + state.motion * 0.18 + state.surge * 0.08),
    mode: "fm",
    synthDrive: clamp(
      0.08
        + state.motion * 0.08
        + (voice.depth ?? 0) * 0.1
        + state.bolts[index].energy * 0.12,
      0,
      0.46,
    ),
    modulationIndex: 0.22 + state.bolts[index].energy * 0.9 + Math.max(0, voice.depth ?? 0) * 0.7,
    modulationRatio: 1.35 + (index % 7) * 0.17,
    gainSmoothingSeconds: state.pointer.pressed ? 0.004 : 0.012,
  }));
  return normalizeVoiceGains(voices, 0.2);
}

function updateAudioVoices() {
  pool.setVoices(continuousVoices(), {
    mode: "fm",
    requestedVoiceCount: state.playing ? state.bolts.length : 0,
    voiceLimit: MAX_VOICES,
  });
}

function updateAudioUi() {
  setPressed($("audioButton"), state.audioOn);
  $("audioButton").disabled = state.audioStarting;
  $("audioState").textContent = state.audioOn ? "on" : "off";
}

async function setAudio(enabled) {
  const next = Boolean(enabled);
  if (state.audioStarting || next === state.audioOn) return;
  if (!next) {
    state.audioOn = false;
    pool.disable();
    updateAudioUi();
    updateReadouts();
    return;
  }
  state.audioStarting = true;
  updateAudioUi();
  clearAudioError();
  try {
    pool.setLevel(state.level);
    updateAudioVoices();
    await pool.enable();
    state.audioOn = true;
    updateAudioVoices();
    announce("Plasma Ball audio on. Move across the globe to attract its synth filaments.");
  } catch (error) {
    state.audioOn = false;
    pool.disable();
    showAudioError(error);
  } finally {
    state.audioStarting = false;
    updateAudioUi();
    updateReadouts();
  }
}

function transientSpecForBolt(bolt, index, keyPrefix = "static") {
  const mapped = plasmaVoiceSpecs([bolt], {
    pointer: pointerForPhysics(),
    radius: 1,
    waveform: index % 3 === 0 ? "sine" : "triangle",
  })[0];
  const depth = clamp(mapped?.depth ?? 0, -1, 1);
  const intensity = clamp(state.motion, 0, 1);
  return {
    ...mapped,
    key: `${keyPrefix}-${bolt.id ?? index}-${bolt.cycle ?? 0}`,
    frequency: pitch01ToFrequency(mapped.pitch01, state.baseFrequency, state.pitchRange),
    gain: clamp(
      0.024
        + (bolt.gate ?? bolt.energy) * 0.045
        + Math.max(0, depth) * 0.01
        + intensity * 0.012,
      0.018,
      0.095,
    ),
    mode: "fm",
    synthDrive: clamp(0.1 + Math.max(0, depth) * 0.18, 0, 0.4),
    modulationIndex: 0.35 + (bolt.energy ?? 0.5) * 1.4,
    modulationRatio: 1.4 + (index % 5) * 0.31,
  };
}

function strikeStaticEvents(events, keyPrefix = "static") {
  if (!state.audioOn) return;
  events.slice(0, MAX_STATIC_STRIKES_PER_FRAME).forEach(({ bolt, index }, eventIndex) => {
    const voice = transientSpecForBolt(bolt, index, keyPrefix);
    const irregularity = ((bolt.seed ?? index) * 0.61803398875) % 1;
    const rate = clamp(bolt.rate ?? 1, 0.08, 4);
    pool.strike(voice, {
      attackSeconds: 0.0015 + irregularity * 0.0025,
      decaySeconds: clamp(0.068 / Math.sqrt(rate) + irregularity * 0.035, 0.018, 0.14),
      attackNoise: 0.5 + state.motion * 0.22 + irregularity * 0.22,
      startDelaySeconds: eventIndex * 0.004,
      retriggerMode: "crossfade",
    });
  });
}

function strikeTouchVoices() {
  const focused = state.bolts
    .map((bolt, index) => ({ bolt, index }))
    .filter(({ bolt }) => (bolt.affinity ?? 0) > 0.54)
    .sort((a, b) => (b.bolt.affinity ?? 0) - (a.bolt.affinity ?? 0))
    .slice(0, 2);
  strikeStaticEvents(focused, "touch");
}

function surge({ announceSurge = true, sound = true } = {}) {
  state.surge = 0.72;
  const phase = Math.floor(state.time * 17);
  state.bolts = state.bolts.map((bolt, index) => ({
    ...bolt,
    age: (index + phase) % 3 === 0 ? bolt.age : (bolt.lifetime ?? 0.2) + 0.001,
    energy: clamp((bolt.energy ?? 0.4) + ((index + phase) % 3 === 0 ? 0.08 : 0.26), 0, 1),
  }));
  if (sound) {
    strikeStaticEvents(
      state.bolts.map((bolt, index) => ({ bolt, index })).filter(({ index }) => (index + phase) % 3 !== 0),
      "surge",
    );
  }
  updateAudioVoices();
  updateReadouts();
  requestFrame();
  if (announceSurge) announce("Electric surge sent through the plasma field.");
}

function updateReadouts() {
  $("boltCount").value = String(state.boltCount);
  $("boltCountOut").textContent = String(state.boltCount);
  $("attraction").value = String(state.attraction);
  $("attractionOut").textContent = percent(state.attraction);
  $("motion").value = String(state.motion);
  $("motionOut").textContent = percent(state.motion);
  $("jitter").value = String(state.jitter);
  $("jitterOut").textContent = percent(state.jitter);
  $("branching").value = String(state.branching);
  $("branchingOut").textContent = percent(state.branching);
  $("baseFrequency").value = String(state.baseFrequency);
  $("baseFrequencyOut").textContent = `${Math.round(state.baseFrequency)} Hz`;
  $("pitchRange").value = String(state.pitchRange);
  $("pitchRangeOut").textContent = `${state.pitchRange.toFixed(1)} oct`;
  $("level").value = String(state.level);
  $("levelOut").textContent = percent(state.level);

  setPressed($("playButton"), state.playing);
  $("playButton").setAttribute("aria-label", state.playing ? "Pause Plasma Ball" : "Play Plasma Ball");
  $("transportLabel").textContent = state.playing ? "Static field active" : "Static field paused";
  $("playSummary").textContent = `${state.playing ? "intermittent" : "paused"} · ${state.pointer.active ? "glass contact" : "glass untouched"}`;
  const activeBolts = state.bolts.filter((bolt) => (bolt.gate ?? bolt.energy ?? 0) > 0.18).length;
  $("fieldSummary").textContent = `${percent(state.motion)} intensity · mixed rates`;
  $("soundSummary").textContent = `mixed-rate impulses · ${state.pitchRange.toFixed(1)} oct · 3D`;
  $("stageReadout").textContent = `${activeBolts}/${state.boltCount} ACTIVE · SLOW↔FAST · 3D ${state.pointer.active ? "PARTIAL FOCUS" : "FREE FIELD"} · AUDIO ${state.audioOn ? "ON" : "OFF"}`;
  canvas.setAttribute(
    "aria-label",
    `Three-dimensional Plasma Ball with ${activeBolts} of ${state.boltCount} electric filaments active at mixed slow and fast rates. ${state.pointer.active ? "Some sparks focus toward the glass contact while others discharge elsewhere." : "The sparks discharge irregularly around the globe."} Audio ${state.audioOn ? "on" : "off"}.`,
  );
  updateAudioUi();
}

function resetInstrument() {
  Object.assign(state, PLASMA_DEFAULTS);
  state.bolts = createPlasmaBolts(PLASMA_DEFAULTS.boltCount, 19);
  state.playing = true;
  state.pointer = { x: 0, y: 0, z: 1, active: false, pressed: false, type: "mouse" };
  state.keyboardAngle = 0;
  state.time = 0;
  state.surge = 0;
  pool.setLevel(state.level);
  updateAudioVoices();
  updateReadouts();
  requestFrame();
  announce("Plasma Ball reset to quiet, irregular three-dimensional static.");
}

function hash01(value) {
  const hashed = Math.sin(value * 12.9898 + 78.233) * 43758.5453123;
  return hashed - Math.floor(hashed);
}

function projectPoint(point) {
  const depth = clamp((Number(point?.z) || 0) / layout.radius, -1, 1);
  const perspective = 0.985 + Math.max(0, depth) * 0.015;
  return {
    x: layout.centerX + (Number(point?.x) || 0) * perspective,
    y: layout.centerY + (Number(point?.y) || 0) * perspective,
    depth,
  };
}

function drawProjectedPath(points) {
  if (points.length < 2) return;
  const first = projectPoint(points[0]);
  context.beginPath();
  context.moveTo(first.x, first.y);
  for (let index = 1; index < points.length; index += 1) {
    const point = projectPoint(points[index]);
    context.lineTo(point.x, point.y);
  }
}

function plasmaColor(index) {
  return ["#d678ff", "#7197ff", "#ff75d4", "#ae86ff", "#82c4ff"][index % 5];
}

function drawBackground() {
  const glow = context.createRadialGradient(
    layout.centerX - layout.radius * 0.08,
    layout.centerY - layout.radius * 0.12,
    0,
    layout.centerX,
    layout.centerY,
    layout.radius * 1.55,
  );
  glow.addColorStop(0, `rgba(198, 90, 255, ${0.065 + state.surge * 0.025})`);
  glow.addColorStop(0.52, "rgba(82, 45, 119, 0.027)");
  glow.addColorStop(1, "rgba(6, 3, 9, 0)");
  context.fillStyle = glow;
  context.fillRect(0, 0, cssWidth, cssHeight);

  context.save();
  context.strokeStyle = "rgba(204, 151, 230, 0.028)";
  context.lineWidth = 1;
  for (let multiplier = 1.18; multiplier <= 1.48; multiplier += 0.15) {
    context.beginPath();
    context.ellipse(
      layout.centerX,
      layout.centerY,
      layout.radius * multiplier,
      layout.radius * multiplier * 0.43,
      -0.16,
      0,
      TAU,
    );
    context.stroke();
  }
  context.restore();
}

function tracePedestal(width, topY, bottomY) {
  context.beginPath();
  context.moveTo(layout.centerX - width * 0.34, topY);
  context.quadraticCurveTo(layout.centerX - width * 0.46, topY + layout.radius * 0.12, layout.centerX - width * 0.5, bottomY);
  context.lineTo(layout.centerX + width * 0.5, bottomY);
  context.quadraticCurveTo(layout.centerX + width * 0.46, topY + layout.radius * 0.12, layout.centerX + width * 0.34, topY);
  context.closePath();
}

function drawPedestal() {
  const width = layout.radius * 0.86;
  const topY = layout.centerY + layout.radius * 0.81;
  const bottomY = Math.min(cssHeight + 5, layout.centerY + layout.radius * 1.25);
  const gradient = context.createLinearGradient(0, topY, 0, bottomY);
  gradient.addColorStop(0, "rgba(38, 25, 47, 0.94)");
  gradient.addColorStop(0.3, "rgba(14, 10, 18, 0.98)");
  gradient.addColorStop(1, "rgba(5, 3, 7, 1)");
  context.save();
  tracePedestal(width, topY, bottomY);
  context.fillStyle = gradient;
  context.fill();
  context.clip();

  const glyphRows = ["+*+*+*+*+", "[[]]{}<>", "//\\||--", "..::==##", "{@}{@}{@}", "<<<+++>>>"];
  const fontSize = clamp(layout.radius * 0.025, 6, 10);
  const rowCount = Math.max(4, Math.floor((bottomY - topY) / (fontSize * 1.18)));
  context.font = `${fontSize}px ui-monospace, SFMono-Regular, Consolas, monospace`;
  context.textAlign = "center";
  context.textBaseline = "middle";
  context.shadowBlur = 5;
  for (let row = 0; row < rowCount; row += 1) {
    const amount = rowCount <= 1 ? 0 : row / (rowCount - 1);
    const y = topY + fontSize * 0.8 + amount * Math.max(0, bottomY - topY - fontSize * 1.2);
    const pattern = glyphRows[row % glyphRows.length];
    const repetitions = 2 + Math.floor((3 + amount * 3) * Math.max(0.65, width / 300));
    context.fillStyle = row % 2
      ? "rgba(113, 151, 255, 0.42)"
      : "rgba(226, 112, 255, 0.46)";
    context.shadowColor = row % 2 ? "#7197ff" : "#d678ff";
    context.fillText(pattern.repeat(repetitions), layout.centerX, y);
  }
  context.restore();

  context.save();
  tracePedestal(width, topY, bottomY);
  context.strokeStyle = "rgba(215, 174, 232, 0.18)";
  context.lineWidth = 1;
  context.stroke();
  context.restore();
}

function drawElectrode() {
  const coreRadius = layout.radius * 0.13;
  const top = layout.centerY + coreRadius * 0.35;
  const bottom = layout.centerY + layout.radius * 0.88;
  const width = coreRadius * 0.62;
  const metal = context.createLinearGradient(layout.centerX - width, 0, layout.centerX + width, 0);
  metal.addColorStop(0, "#211926");
  metal.addColorStop(0.27, "#8f7a98");
  metal.addColorStop(0.5, "#f3e9f6");
  metal.addColorStop(0.68, "#796481");
  metal.addColorStop(1, "#19131d");
  context.save();
  context.fillStyle = metal;
  context.strokeStyle = "rgba(255, 245, 255, 0.32)";
  context.lineWidth = 1;
  context.fillRect(layout.centerX - width / 2, top, width, bottom - top);
  context.strokeRect(layout.centerX - width / 2, top, width, bottom - top);
  context.restore();
}

function drawGlassInterior() {
  const interior = context.createRadialGradient(
    layout.centerX - layout.radius * 0.3,
    layout.centerY - layout.radius * 0.34,
    layout.radius * 0.04,
    layout.centerX + layout.radius * 0.1,
    layout.centerY + layout.radius * 0.12,
    layout.radius * 1.04,
  );
  interior.addColorStop(0, "rgba(172, 118, 202, 0.072)");
  interior.addColorStop(0.45, "rgba(61, 32, 83, 0.055)");
  interior.addColorStop(0.78, "rgba(26, 15, 35, 0.16)");
  interior.addColorStop(1, "rgba(8, 5, 12, 0.42)");
  context.save();
  context.beginPath();
  context.arc(layout.centerX, layout.centerY, layout.radius, 0, TAU);
  context.clip();
  context.fillStyle = interior;
  context.fillRect(
    layout.centerX - layout.radius,
    layout.centerY - layout.radius,
    layout.radius * 2,
    layout.radius * 2,
  );
  context.strokeStyle = "rgba(205, 157, 226, 0.045)";
  context.lineWidth = 1;
  for (const amount of [-0.58, -0.28, 0, 0.28, 0.58]) {
    context.beginPath();
    context.ellipse(
      layout.centerX,
      layout.centerY + amount * layout.radius,
      layout.radius * Math.sqrt(Math.max(0.08, 1 - amount * amount)),
      layout.radius * 0.11,
      0,
      0,
      TAU,
    );
    context.stroke();
  }
  context.restore();
}

function collectBoltRenderData() {
  return state.bolts.map((bolt, index) => {
    const path = plasmaBoltPath(bolt, {
      radius: layout.radius,
      time: state.time,
      jitter: state.jitter,
      branching: state.branching,
      segments: state.reducedMotion ? 12 : 18,
    });
    const endpoint = path.trunk.at(-1) ?? { x: 0, y: 0, z: 0 };
    return {
      bolt,
      index,
      path,
      endpoint,
      depth: clamp((Number(endpoint.z) || 0) / layout.radius, -1, 1),
    };
  }).sort((a, b) => a.depth - b.depth);
}

function drawBolt({ bolt, index, path, endpoint, depth }) {
  const color = plasmaColor(index);
  const gate = clamp(bolt.gate ?? bolt.energy ?? 0, 0, 1);
  const intensity = 0.55 + state.motion * 0.65;
  const energy = clamp(
    (bolt.energy ?? 0.4) * (0.3 + gate * 0.7) * intensity + state.surge * 0.06,
    0,
    1,
  );
  const near = (depth + 1) / 2;
  const visibility = (0.08 + gate * 0.92) * (0.28 + near * 0.72);

  context.save();
  context.globalCompositeOperation = "lighter";
  context.lineJoin = "miter";
  context.lineCap = "butt";
  context.strokeStyle = color;
  context.globalAlpha = visibility * 0.12;
  context.lineWidth = 3 + energy * (4 + near * 4);
  context.shadowColor = color;
  context.shadowBlur = 8 + energy * (7 + near * 10);
  drawProjectedPath(path.trunk);
  context.stroke();

  context.globalAlpha = visibility * 0.84;
  context.lineWidth = 0.65 + energy * (0.8 + near * 0.8);
  context.shadowBlur = 3 + near * 6;
  drawProjectedPath(path.trunk);
  context.stroke();

  if (gate > 0.18) {
    context.strokeStyle = "#fff8ff";
    context.globalAlpha = visibility * 0.56;
    context.lineWidth = 0.36 + near * 0.34;
    context.shadowBlur = 2;
    drawProjectedPath(path.trunk);
    context.stroke();
  }

  for (const branch of path.branches) {
    context.strokeStyle = color;
    context.globalAlpha = visibility * 0.48;
    context.lineWidth = 0.38 + energy * 0.62 + near * 0.22;
    context.shadowBlur = 2 + near * 4;
    drawProjectedPath(branch);
    context.stroke();
  }

  if (gate > 0.12) {
    const projected = projectPoint(endpoint);
    context.fillStyle = "#fff8ff";
    context.globalAlpha = visibility * 0.74;
    context.shadowColor = color;
    context.shadowBlur = 5 + near * 9;
    context.beginPath();
    context.arc(projected.x, projected.y, 0.8 + energy * 1.1 + near * 0.5, 0, TAU);
    context.fill();
  }
  context.restore();
}

function drawBoltLayer(renderData, front) {
  context.save();
  context.beginPath();
  context.arc(layout.centerX, layout.centerY, layout.radius * 0.994, 0, TAU);
  context.clip();
  renderData
    .filter(({ depth }) => front ? depth >= -0.04 : depth < -0.04)
    .forEach(drawBolt);
  context.restore();
}

function drawCore() {
  const pulse = state.reducedMotion
    ? 0.5
    : 0.5 + Math.sin(state.time * 7.1) * 0.3 + Math.sin(state.time * 17.7) * 0.2;
  const outerRadius = layout.radius * (0.13 + pulse * 0.005 + state.surge * 0.006);
  const aura = context.createRadialGradient(
    layout.centerX,
    layout.centerY,
    0,
    layout.centerX,
    layout.centerY,
    outerRadius * 2.8,
  );
  aura.addColorStop(0, "rgba(255, 250, 255, 0.96)");
  aura.addColorStop(0.12, "rgba(237, 176, 255, 0.86)");
  aura.addColorStop(0.37, `rgba(185, 78, 245, ${0.26 + state.surge * 0.08})`);
  aura.addColorStop(1, "rgba(130, 55, 205, 0)");
  context.save();
  context.globalCompositeOperation = "lighter";
  context.fillStyle = aura;
  context.beginPath();
  context.arc(layout.centerX, layout.centerY, outerRadius * 2.8, 0, TAU);
  context.fill();
  context.restore();

  const metal = context.createRadialGradient(
    layout.centerX - outerRadius * 0.34,
    layout.centerY - outerRadius * 0.38,
    outerRadius * 0.08,
    layout.centerX,
    layout.centerY,
    outerRadius,
  );
  metal.addColorStop(0, "#fffaff");
  metal.addColorStop(0.22, "#e9c9f0");
  metal.addColorStop(0.58, "#9f83aa");
  metal.addColorStop(1, "#35283c");
  context.fillStyle = metal;
  context.strokeStyle = "rgba(255, 245, 255, 0.68)";
  context.lineWidth = 1;
  context.beginPath();
  context.arc(layout.centerX, layout.centerY, outerRadius, 0, TAU);
  context.fill();
  context.stroke();
}

function drawGlass() {
  const rim = context.createLinearGradient(
    layout.centerX - layout.radius,
    layout.centerY - layout.radius,
    layout.centerX + layout.radius,
    layout.centerY + layout.radius,
  );
  rim.addColorStop(0, "rgba(255, 246, 255, 0.72)");
  rim.addColorStop(0.26, "rgba(181, 127, 211, 0.18)");
  rim.addColorStop(0.58, "rgba(120, 87, 158, 0.34)");
  rim.addColorStop(1, "rgba(240, 205, 255, 0.58)");
  context.save();
  context.strokeStyle = rim;
  context.lineWidth = Math.max(1.2, layout.radius * 0.009);
  context.shadowColor = "rgba(207, 124, 255, 0.35)";
  context.shadowBlur = 15;
  context.beginPath();
  context.arc(layout.centerX, layout.centerY, layout.radius, 0, TAU);
  context.stroke();
  context.restore();

  const edgeShade = context.createRadialGradient(
    layout.centerX - layout.radius * 0.22,
    layout.centerY - layout.radius * 0.25,
    layout.radius * 0.35,
    layout.centerX,
    layout.centerY,
    layout.radius,
  );
  edgeShade.addColorStop(0, "rgba(255,255,255,0)");
  edgeShade.addColorStop(0.72, "rgba(51,27,65,0.015)");
  edgeShade.addColorStop(0.94, "rgba(18,9,24,0.12)");
  edgeShade.addColorStop(1, "rgba(3,2,5,0.32)");
  context.save();
  context.beginPath();
  context.arc(layout.centerX, layout.centerY, layout.radius * 0.994, 0, TAU);
  context.clip();
  context.fillStyle = edgeShade;
  context.fillRect(
    layout.centerX - layout.radius,
    layout.centerY - layout.radius,
    layout.radius * 2,
    layout.radius * 2,
  );
  context.restore();

  context.save();
  context.strokeStyle = "rgba(255, 255, 255, 0.19)";
  context.lineWidth = Math.max(1, layout.radius * 0.012);
  context.lineCap = "round";
  context.beginPath();
  context.arc(layout.centerX, layout.centerY, layout.radius * 0.965, Math.PI * 1.04, Math.PI * 1.48);
  context.stroke();
  context.restore();

  context.save();
  context.strokeStyle = "rgba(255, 255, 255, 0.09)";
  context.lineWidth = Math.max(1, layout.radius * 0.006);
  context.beginPath();
  context.ellipse(
    layout.centerX - layout.radius * 0.17,
    layout.centerY - layout.radius * 0.18,
    layout.radius * 0.57,
    layout.radius * 0.83,
    -0.52,
    Math.PI * 1.03,
    Math.PI * 1.39,
  );
  context.stroke();
  context.restore();

  if (state.pointer.active) {
    const x = layout.centerX + state.pointer.x * layout.radius;
    const y = layout.centerY + state.pointer.y * layout.radius;
    const color = state.pointer.pressed ? "#fff7ff" : "#efbdff";
    context.save();
    context.globalCompositeOperation = "lighter";
    context.strokeStyle = color;
    context.fillStyle = color;
    context.shadowColor = "#dd83ff";
    context.shadowBlur = state.pointer.pressed ? 22 : 13;
    context.lineWidth = 1;
    context.beginPath();
    context.ellipse(x, y, state.pointer.pressed ? 9 : 6, state.pointer.pressed ? 5 : 3.5, 0, 0, TAU);
    context.stroke();
    context.globalAlpha = 0.75;
    context.beginPath();
    context.arc(x, y, state.pointer.pressed ? 2.8 : 1.8, 0, TAU);
    context.fill();
    context.restore();
  }
}

function drawStaticCorona() {
  const tick = state.reducedMotion ? 0 : Math.floor(state.time * (5 + state.motion * 29));
  context.save();
  context.globalCompositeOperation = "lighter";
  context.lineCap = "round";
  for (let index = 0; index < 104; index += 1) {
    const seed = index * 37.17 + tick * 0.071;
    const angle = index / 104 * TAU + (hash01(seed) - 0.5) * 0.045;
    const flicker = hash01(seed * 1.73 + tick * 7.1);
    if (flicker < 0.46) continue;
    const inset = layout.radius * (0.992 - hash01(seed * 2.1) * 0.01);
    const length = layout.radius * (0.008 + hash01(seed * 3.9) * 0.035) * (0.35 + state.jitter * 0.65);
    const bend = (hash01(seed * 5.7) - 0.5) * 0.055;
    const startX = layout.centerX + Math.cos(angle) * inset;
    const startY = layout.centerY + Math.sin(angle) * inset;
    const endX = layout.centerX + Math.cos(angle + bend) * (inset + length);
    const endY = layout.centerY + Math.sin(angle + bend) * (inset + length);
    context.strokeStyle = index % 3 === 0 ? "#739dff" : "#d678ff";
    context.globalAlpha = 0.035 + flicker * 0.12;
    context.lineWidth = 0.35 + flicker * 0.5;
    context.shadowColor = context.strokeStyle;
    context.shadowBlur = 3;
    context.beginPath();
    context.moveTo(startX, startY);
    context.lineTo(endX, endY);
    context.stroke();
  }
  context.restore();
}

function draw() {
  context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
  context.clearRect(0, 0, cssWidth, cssHeight);
  drawBackground();
  drawPedestal();
  drawGlassInterior();
  drawElectrode();
  const renderData = collectBoltRenderData();
  drawBoltLayer(renderData, false);
  drawCore();
  drawBoltLayer(renderData, true);
  drawGlass();
  drawStaticCorona();
}

function frame(timestamp) {
  frameRequest = 0;
  if (!pageActive) return;
  if (lastFrameAt === null) lastFrameAt = timestamp;
  const visualInterval = state.reducedMotion ? 1_000 / 12 : VISUAL_FRAME_INTERVAL;
  if (timestamp - lastFrameAt < visualInterval) {
    if (state.playing || state.pointer.active || state.surge > 0) requestFrame();
    return;
  }
  const dt = clamp((timestamp - lastFrameAt) / 1_000, 0, 0.05);
  lastFrameAt = timestamp;

  if (state.playing) {
    const motionScale = state.reducedMotion ? 0.18 : 1;
    state.time += dt * motionScale;
    const previousBolts = state.bolts;
    const nextBolts = stepPlasmaBolts(previousBolts, {
      dt: dt * motionScale,
      time: state.time,
      pointer: pointerForPhysics(),
      attraction: state.attraction,
      speed: state.motion,
    });
    const staticEvents = nextBolts.flatMap((bolt, index) => {
      const previous = previousBolts[index];
      const rewired = Number.isFinite(bolt.cycle)
        && Number.isFinite(previous?.cycle)
        && bolt.cycle !== previous.cycle;
      const opened = (bolt.gate ?? 0) > 0.44 && (previous?.gate ?? 0) <= 0.44;
      return rewired || opened ? [{ bolt, index }] : [];
    });
    state.bolts = nextBolts;
    if (staticEvents.length) strikeStaticEvents(staticEvents);
    if (timestamp - lastAudioAt >= AUDIO_FRAME_INTERVAL) {
      lastAudioAt = timestamp;
      updateAudioVoices();
    }
  }
  state.surge = Math.max(0, state.surge - dt * 1.8);

  draw();
  if (state.playing || state.pointer.active || state.surge > 0) requestFrame();
}

function setPointerFromClient(clientX, clientY, { active = true, pressed = state.pointer.pressed, type = state.pointer.type } = {}) {
  const bounds = canvas.getBoundingClientRect();
  const x = clientX - bounds.left - layout.centerX;
  const y = clientY - bounds.top - layout.centerY;
  const distance = Math.hypot(x, y);
  const inside = distance <= layout.radius * 1.02;
  const wasActive = state.pointer.active;
  const wasPressed = state.pointer.pressed;
  if (!active || (!inside && !(pressed && wasActive))) {
    state.pointer = { ...state.pointer, active: false, pressed: false };
  } else {
    let normalizedX = x / layout.radius;
    let normalizedY = y / layout.radius;
    const normalizedLength = Math.hypot(normalizedX, normalizedY);
    if (normalizedLength > 0.998) {
      normalizedX = normalizedX / normalizedLength * 0.998;
      normalizedY = normalizedY / normalizedLength * 0.998;
    }
    const depth = Math.sqrt(Math.max(0, 1 - normalizedX ** 2 - normalizedY ** 2));
    state.pointer = {
      x: normalizedX,
      y: normalizedY,
      z: depth,
      active: true,
      pressed,
      type,
    };
    state.keyboardAngle = wrapAngle(Math.atan2(normalizedY, normalizedX));
  }
  if (wasPressed !== state.pointer.pressed) {
    canvas.classList.toggle("is-touching", state.pointer.pressed);
  }
  if (wasActive !== state.pointer.active) updateReadouts();
  requestFrame();
}

function clientPointTouchesGlass(clientX, clientY) {
  const bounds = canvas.getBoundingClientRect();
  const x = clientX - bounds.left - layout.centerX;
  const y = clientY - bounds.top - layout.centerY;
  return Math.hypot(x, y) <= layout.radius * 1.02;
}

function setKeyboardPointer(angle) {
  state.keyboardAngle = wrapAngle(angle);
  const radial = 0.72;
  state.pointer = {
    x: Math.cos(state.keyboardAngle) * radial,
    y: Math.sin(state.keyboardAngle) * radial,
    z: Math.sqrt(1 - radial ** 2),
    active: true,
    pressed: false,
    type: "keyboard",
  };
  updateReadouts();
  updateAudioVoices();
  requestFrame();
}

$("audioButton").addEventListener("click", () => setAudio(!state.audioOn));

$("playButton").addEventListener("click", () => {
  state.playing = !state.playing;
  updateAudioVoices();
  updateReadouts();
  requestFrame();
  announce(state.playing ? "Plasma field running." : "Plasma field paused.");
});

$("surgeButton").addEventListener("click", () => surge());
$("resetButton").addEventListener("click", resetInstrument);

for (const [id, property] of [
  ["attraction", "attraction"],
  ["motion", "motion"],
  ["jitter", "jitter"],
  ["branching", "branching"],
  ["baseFrequency", "baseFrequency"],
  ["pitchRange", "pitchRange"],
]) {
  $(id).addEventListener("input", (event) => {
    state[property] = Number(event.currentTarget.value);
    updateReadouts();
    updateAudioVoices();
    requestFrame();
  });
}

$("boltCount").addEventListener("input", (event) => {
  state.boltCount = Math.round(Number(event.currentTarget.value));
  state.bolts = createPlasmaBolts(state.boltCount, 19 + state.time * 0.013);
  updateReadouts();
  updateAudioVoices();
  requestFrame();
});

$("level").addEventListener("input", (event) => {
  state.level = Number(event.currentTarget.value);
  pool.setLevel(state.level);
  updateReadouts();
});

canvas.addEventListener("pointermove", (event) => {
  setPointerFromClient(event.clientX, event.clientY, {
    active: true,
    pressed: state.pointer.pressed,
    type: event.pointerType || "mouse",
  });
});

canvas.addEventListener("pointerdown", (event) => {
  if (!clientPointTouchesGlass(event.clientX, event.clientY)) return;
  event.preventDefault();
  canvas.setPointerCapture?.(event.pointerId);
  canvas.focus({ preventScroll: true });
  setPointerFromClient(event.clientX, event.clientY, {
    active: true,
    pressed: true,
    type: event.pointerType || "mouse",
  });
  const needsAudio = !state.audioOn;
  if (!needsAudio) strikeTouchVoices();
  if (needsAudio) {
    void setAudio(true).then(() => {
      if (state.audioOn) strikeTouchVoices();
    });
  }
  announce("Glass contact. Some sparks focus toward the pointer while the rest keep searching the globe.");
});

canvas.addEventListener("pointerup", (event) => {
  const touch = (event.pointerType || state.pointer.type) === "touch";
  setPointerFromClient(event.clientX, event.clientY, {
    active: !touch,
    pressed: false,
    type: event.pointerType || state.pointer.type,
  });
  canvas.releasePointerCapture?.(event.pointerId);
});

canvas.addEventListener("pointercancel", () => {
  state.pointer = { ...state.pointer, active: false, pressed: false };
  canvas.classList.remove("is-touching");
  updateReadouts();
  updateAudioVoices();
  requestFrame();
});

canvas.addEventListener("pointerleave", () => {
  if (state.pointer.pressed) return;
  state.pointer = { ...state.pointer, active: false };
  updateReadouts();
  updateAudioVoices();
  requestFrame();
});

canvas.addEventListener("keydown", (event) => {
  if (event.key === " " || event.code === "Space") {
    event.preventDefault();
    $("playButton").click();
  } else if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
    event.preventDefault();
    const direction = event.key === "ArrowRight" ? 1 : -1;
    setKeyboardPointer(state.keyboardAngle + direction * Math.PI / 24);
  } else if (event.key === "Enter") {
    event.preventDefault();
    surge();
  } else if (event.key === "Escape") {
    state.pointer = { ...state.pointer, active: false, pressed: false };
    void setAudio(false);
    updateReadouts();
    requestFrame();
  }
});

reducedMotionQuery?.addEventListener?.("change", (event) => {
  state.reducedMotion = event.matches;
  requestFrame();
});

globalThis.addEventListener("resize", () => {
  resizeCanvas();
  requestFrame();
}, { passive: true });

document.addEventListener("visibilitychange", () => {
  if (document.hidden) {
    if (frameRequest) cancelAnimationFrame(frameRequest);
    frameRequest = 0;
    lastFrameAt = null;
    pool.setVoices([]);
    return;
  }
  lastFrameAt = null;
  updateAudioVoices();
  requestFrame();
});

if (typeof ResizeObserver === "function") {
  new ResizeObserver(() => {
    resizeCanvas();
    requestFrame();
  }).observe(stageWrap);
}

globalThis.addEventListener("pagehide", () => {
  pageActive = false;
  if (frameRequest) cancelAnimationFrame(frameRequest);
  frameRequest = 0;
  void pool.close();
}, { once: true });

pool.setLevel(state.level);
resizeCanvas();
updateReadouts();
updateAudioVoices();
requestFrame();

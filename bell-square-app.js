import { VoicePool } from "./src/audio.js";
import {
  BELL_SQUARE_OUTCOMES,
  DEFAULT_SAMPLE_SEED,
  sampleJoint,
  simulateBellSquare,
} from "./src/bell-square.js";

const $ = (id) => document.getElementById(id);
const TAU = Math.PI * 2;
const DEG_TO_RAD = Math.PI / 180;
const DRAW_INTERVAL = 1_000 / 30;
const DEFAULTS = Object.freeze({
  collisionPhase: 180,
  aliceAxis: 0,
  bobAxis: 0,
  dephasing: 0,
  level: 0.48,
});
const COLORS = Object.freeze({
  amber: "#ffb86b",
  blue: "#7db4ff",
  mint: "#5fe8c4",
  pink: "#ff7aa6",
  cream: "#fff3d6",
  ink: "#07090b",
});
const OUTCOME_COLORS = Object.freeze([
  COLORS.amber,
  COLORS.blue,
  COLORS.mint,
  COLORS.pink,
]);

const reducedMotion = globalThis.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches ?? false;
const canvas = $("stage");
const stageWrap = $("stageWrap");
const context2d = canvas.getContext("2d", { alpha: true, desynchronized: true });
const voices = new VoicePool(8);

const state = {
  ...DEFAULTS,
  playing: false,
  audioOn: false,
  audioStarting: false,
  sampleSerial: 0,
  lastShot: null,
  lastOutcome: null,
  measurementFlashUntil: 0,
};

let simulation = calculateSimulation();
let frameId = null;
let lastFrameTime = 0;
let lastDrawTime = -Infinity;
let cssWidth = 1;
let cssHeight = 1;
let pixelRatio = 1;
let visualizationDirty = true;
let disposed = false;
let pageActive = true;
let audioRequest = 0;

function clamp(value, minimum, maximum) {
  return Math.min(maximum, Math.max(minimum, value));
}

function setPressed(element, pressed) {
  element.setAttribute("aria-pressed", String(Boolean(pressed)));
}

function calculateSimulation() {
  return simulateBellSquare({
    collisionPhase: state.collisionPhase * DEG_TO_RAD,
    aliceAxis: state.aliceAxis * DEG_TO_RAD,
    bobAxis: state.bobAxis * DEG_TO_RAD,
    dephasing: state.dephasing,
  });
}

function announce(message) {
  $("liveStatus").textContent = "";
  requestAnimationFrame(() => {
    if (!disposed && pageActive) $("liveStatus").textContent = message;
  });
}

function showAudioError(error) {
  const message = error instanceof Error ? error.message : String(error);
  $("audioError").textContent = message;
  $("audioError").hidden = false;
  announce(`Audio error: ${message}`);
}

function clearAudioError() {
  $("audioError").textContent = "";
  $("audioError").hidden = true;
}

function near(value, target, tolerance = 0.006) {
  return Math.abs(value - target) <= tolerance;
}

function phaseLabel(degrees, includeDegrees = true) {
  const turns = clamp(Number(degrees) || 0, 0, 360) / 180;
  let symbol;
  if (near(turns, 0)) symbol = "0";
  else if (near(turns, 0.5)) symbol = "π/2";
  else if (near(turns, 1)) symbol = "π";
  else if (near(turns, 1.5)) symbol = "3π/2";
  else if (near(turns, 2)) symbol = "2π";
  else symbol = `${turns.toFixed(2)}π`;
  return includeDegrees ? `${symbol} · ${Math.round(degrees)}°` : symbol;
}

function axisLabel(degrees, includeDegrees = true) {
  const normalized = Math.round(Number(degrees) || 0);
  let symbol = "tilted";
  if (normalized === 0) symbol = "Z";
  else if (normalized === 90) symbol = "X";
  else if (normalized === -90) symbol = "−X";
  else if (Math.abs(normalized) === 180) symbol = "−Z";
  return includeDegrees ? `${symbol} · ${normalized}°` : symbol;
}

function percentage(value, digits = 1) {
  return `${(clamp(Number(value) || 0, 0, 1) * 100).toFixed(digits)}%`;
}

function signed(value) {
  const numeric = Math.abs(value) < 0.0005 ? 0 : value;
  return `${numeric >= 0 ? "+" : ""}${numeric.toFixed(3)}`;
}

function entanglementLabel(concurrence) {
  if (concurrence < 0.001) return "separable";
  if (concurrence > 0.999) return "maximally entangled";
  return "entangled";
}

function shotSummary(shot) {
  if (!shot) return "no shots yet";
  if (shot.shots === 1) return `${shot.outcomes[0]} · seed ${shot.seed.toString(16)}`;
  return BELL_SQUARE_OUTCOMES.map((outcome) => `${outcome} ${shot.counts[outcome]}`).join(" · ");
}

function dyadForOutcome(outcomeIndex) {
  const roots = [110, 138.59, 164.81, 207.65];
  const baseIntervals = [7, 5, 8, 4];
  const tensionDirections = [5, -3, 4, 7];
  const phase = state.collisionPhase * DEG_TO_RAD;
  const signedTension = simulation.idealConcurrence * (0.65 + 0.35 * Math.sin(phase));
  const interval = baseIntervals[outcomeIndex] + tensionDirections[outcomeIndex] * signedTension;
  const root = roots[outcomeIndex];
  return [root, root * 2 ** (interval / 12)];
}

function updateAudioVoices() {
  const voiceSpecs = [];
  simulation.probabilities.forEach((probability, outcomeIndex) => {
    const [aliceFrequency, bobFrequency] = dyadForOutcome(outcomeIndex);
    const weightedGain = probability * 0.2;
    voiceSpecs.push(
      {
        key: `bell-square-${outcomeIndex}-alice`,
        frequency: aliceFrequency,
        gain: weightedGain,
        pan: -0.68,
        waveform: "sine",
      },
      {
        key: `bell-square-${outcomeIndex}-bob`,
        frequency: bobFrequency,
        gain: weightedGain,
        pan: 0.68,
        waveform: "sine",
      },
    );
  });
  voices.setVoices(voiceSpecs);
}

function strikeOutcome(outcome, startDelaySeconds = 0, gain = 0.24) {
  if (!state.audioOn) return;
  const index = BELL_SQUARE_OUTCOMES.indexOf(outcome);
  if (index < 0) return;
  const [aliceFrequency, bobFrequency] = dyadForOutcome(index);
  const delay = clamp(startDelaySeconds, 0, 0.035);
  voices.strike({
    frequency: aliceFrequency * 2,
    gain,
    pan: -0.72,
    waveform: "sine",
  }, {
    attackSeconds: 0.004,
    decaySeconds: 0.38,
    startDelaySeconds: delay,
  });
  voices.strike({
    frequency: bobFrequency * 2,
    gain,
    pan: 0.72,
    waveform: "sine",
  }, {
    attackSeconds: 0.006,
    decaySeconds: 0.48,
    startDelaySeconds: delay + 0.012,
  });
}

function updateReadouts() {
  const phase = phaseLabel(state.collisionPhase);
  const alice = axisLabel(state.aliceAxis);
  const bob = axisLabel(state.bobAxis);
  const stateKind = entanglementLabel(simulation.concurrence);

  $("collisionPhase").value = String(state.collisionPhase);
  $("aliceAxis").value = String(state.aliceAxis);
  $("bobAxis").value = String(state.bobAxis);
  $("dephasing").value = String(state.dephasing);
  $("level").value = String(state.level);
  $("collisionPhaseOut").textContent = phase;
  $("aliceAxisOut").textContent = alice;
  $("bobAxisOut").textContent = bob;
  $("dephasingOut").textContent = percentage(state.dephasing, 0);
  $("levelOut").textContent = percentage(state.level, 0);
  $("collisionSummary").textContent = `${simulation.idealConcurrence > 0.999 ? "Bell phase" : "CP phase"} · ${phaseLabel(state.collisionPhase, false)}`;
  $("measureSummary").textContent = `${axisLabel(state.aliceAxis, false)} × ${axisLabel(state.bobAxis, false)} · ${state.dephasing > 0 ? `${percentage(state.dephasing, 0)} dephased` : "coherent"}`;
  $("stateSummary").textContent = `${stateKind} · C ${simulation.concurrence.toFixed(3)}`;
  $("concurrenceReadout").textContent = simulation.concurrence.toFixed(3);
  $("correlationReadout").textContent = signed(simulation.correlation);
  $("globalPurityReadout").textContent = simulation.globalPurity.toFixed(3);
  $("localPurityReadout").textContent = `${simulation.alicePurity.toFixed(3)} / ${simulation.bobPurity.toFixed(3)}`;
  $("lastOutcome").textContent = state.lastOutcome ?? "—";
  $("shotSummary").textContent = shotSummary(state.lastShot);
  simulation.probabilities.forEach((probability, index) => {
    $(`probability${BELL_SQUARE_OUTCOMES[index]}`).textContent = percentage(probability);
  });

  const compactAlice = axisLabel(state.aliceAxis, false);
  const compactBob = axisLabel(state.bobAxis, false);
  $("stageReadout").textContent = [
    `CP ${phaseLabel(state.collisionPhase, false)}`,
    `${compactAlice} × ${compactBob}`,
    `C ${simulation.concurrence.toFixed(3)}`,
    state.audioOn ? "AUDIO ON" : "AUDIO OFF",
  ].join(" · ");
  canvas.setAttribute(
    "aria-label",
    `Bell Square at collision phase ${Math.round(state.collisionPhase)} degrees. Alice measures ${Math.round(state.aliceAxis)} degrees and Bob ${Math.round(state.bobAxis)} degrees. Concurrence ${simulation.concurrence.toFixed(3)}. Correlation ${simulation.correlation.toFixed(3)}. ${state.lastOutcome ? `Last result ${state.lastOutcome}.` : "No measurement yet."}`,
  );
}

function updateTransport() {
  setPressed($("playButton"), state.playing);
  $("playButton").setAttribute(
    "aria-label",
    state.playing ? "Pause automatic collision dance" : "Play automatic collision dance",
  );
  document.body.classList.toggle("is-playing", state.playing);
}

function updateAudioInterface() {
  setPressed($("audioButton"), state.audioOn);
  $("audioButton").disabled = state.audioStarting;
  $("audioState").textContent = state.audioOn ? "on" : "off";
}

function refreshSimulation({ announceMessage = "" } = {}) {
  simulation = calculateSimulation();
  updateReadouts();
  updateAudioVoices();
  visualizationDirty = true;
  scheduleVisualization();
  if (announceMessage) announce(announceMessage);
}

function setCollisionPhase(value, { announceChange = false } = {}) {
  state.collisionPhase = clamp(Math.round(Number(value) || 0), 0, 360);
  refreshSimulation();
  if (announceChange) {
    announce(`Controlled phase ${phaseLabel(state.collisionPhase)}. Concurrence ${simulation.concurrence.toFixed(3)}.`);
  }
}

function togglePlaying() {
  if (!pageActive || disposed) return;
  state.playing = !state.playing;
  lastFrameTime = performance.now();
  updateTransport();
  visualizationDirty = true;
  scheduleVisualization();
  announce(`Automatic collision dance ${state.playing ? "playing" : "paused"}.`);
}

async function toggleAudio() {
  if (state.audioStarting || !pageActive || disposed) return;
  const request = ++audioRequest;
  clearAudioError();
  if (state.audioOn) {
    voices.disable();
    state.audioOn = false;
    updateAudioInterface();
    updateReadouts();
    visualizationDirty = true;
    scheduleVisualization();
    announce("Bell Square audio off.");
    return;
  }

  state.audioStarting = true;
  updateAudioInterface();
  try {
    voices.setLevel(state.level);
    updateAudioVoices();
    await voices.start();
    if (request !== audioRequest || !pageActive || disposed) {
      if (!state.audioStarting || !pageActive || disposed) voices.disable();
      return;
    }
    state.audioOn = true;
    announce("Bell Square audio on. Four stereo dyads now follow the joint probabilities.");
  } catch (error) {
    if (request === audioRequest) {
      voices.disable();
      state.audioOn = false;
      showAudioError(error);
    }
  } finally {
    if (request === audioRequest) state.audioStarting = false;
    updateAudioInterface();
    updateReadouts();
    visualizationDirty = true;
    scheduleVisualization();
  }
}

function turnAudioOff(message = "Bell Square audio off.") {
  if (!state.audioOn && !state.audioStarting) return;
  audioRequest += 1;
  voices.disable();
  state.audioOn = false;
  state.audioStarting = false;
  updateAudioInterface();
  updateReadouts();
  visualizationDirty = true;
  scheduleVisualization();
  announce(message);
}

function performMeasurement(shots) {
  state.sampleSerial += 1;
  const result = sampleJoint(simulation.probabilities, {
    shots,
    seed: (DEFAULT_SAMPLE_SEED + Math.imul(state.sampleSerial, 0x9e3779b1)) >>> 0,
  });
  state.lastShot = result;
  state.lastOutcome = result.outcomes.at(-1);
  state.measurementFlashUntil = performance.now() + (reducedMotion ? 220 : 620);

  if (shots === 1) {
    strikeOutcome(state.lastOutcome);
    announce(`Measured ${state.lastOutcome}. Alice read ${state.lastOutcome[0]}; Bob read ${state.lastOutcome[1]}.`);
  } else {
    BELL_SQUARE_OUTCOMES.filter((outcome) => result.counts[outcome] > 0).forEach((outcome, index) => {
      strikeOutcome(outcome, index * 0.01, 0.07);
    });
    announce(`32 shots complete. ${shotSummary(result)}.`);
  }

  updateReadouts();
  visualizationDirty = true;
  scheduleVisualization();
}

function resetInstrument() {
  state.collisionPhase = DEFAULTS.collisionPhase;
  state.aliceAxis = DEFAULTS.aliceAxis;
  state.bobAxis = DEFAULTS.bobAxis;
  state.dephasing = DEFAULTS.dephasing;
  state.level = DEFAULTS.level;
  state.playing = false;
  state.sampleSerial = 0;
  state.lastShot = null;
  state.lastOutcome = null;
  state.measurementFlashUntil = 0;
  voices.setLevel(state.level);
  clearAudioError();
  updateTransport();
  refreshSimulation({ announceMessage: "Bell Square reset to Bell Φ+ in the Z × Z basis." });
}

function roundedRect(context, x, y, width, height, radius) {
  const safeRadius = Math.min(radius, width / 2, height / 2);
  context.beginPath();
  context.roundRect?.(x, y, width, height, safeRadius);
  if (typeof context.roundRect !== "function") {
    context.moveTo(x + safeRadius, y);
    context.arcTo(x + width, y, x + width, y + height, safeRadius);
    context.arcTo(x + width, y + height, x, y + height, safeRadius);
    context.arcTo(x, y + height, x, y, safeRadius);
    context.arcTo(x, y, x + width, y, safeRadius);
    context.closePath();
  }
}

function drawBackground(context, width, height, timestamp) {
  context.clearRect(0, 0, width, height);
  const background = context.createLinearGradient(0, 0, width, height);
  background.addColorStop(0, "#05080b");
  background.addColorStop(0.48, "#080b11");
  background.addColorStop(1, "#050709");
  context.fillStyle = background;
  context.fillRect(0, 0, width, height);

  const pulse = reducedMotion ? 0.48 : 0.48 + Math.sin(timestamp * 0.0007) * 0.05;
  const halo = context.createRadialGradient(width * 0.48, height * 0.48, 0, width * 0.48, height * 0.48, width * 0.54);
  halo.addColorStop(0, `rgba(125, 180, 255, ${0.08 * pulse})`);
  halo.addColorStop(0.45, `rgba(95, 232, 196, ${0.035 * pulse})`);
  halo.addColorStop(1, "rgba(5, 7, 9, 0)");
  context.fillStyle = halo;
  context.fillRect(0, 0, width, height);
}

function drawOpticalLattice(context, layout, timestamp) {
  const { leftWell, rightWell, wellY, wellRadius, compact } = layout;
  const regionLeft = leftWell - wellRadius * 1.7;
  const regionRight = rightWell + wellRadius * 1.7;
  const regionTop = wellY - wellRadius * 1.25;
  const regionBottom = wellY + wellRadius * 1.25;
  const phase = state.collisionPhase * DEG_TO_RAD;
  const collision = Math.sin(phase / 2) ** 2;

  context.save();
  context.lineWidth = 1;
  for (let line = 0; line < 9; line += 1) {
    const progress = line / 8;
    const y = regionTop + progress * (regionBottom - regionTop);
    context.beginPath();
    context.moveTo(regionLeft, y);
    context.bezierCurveTo(
      leftWell,
      y + Math.sin(progress * Math.PI) * 5,
      rightWell,
      y - Math.sin(progress * Math.PI) * 5,
      regionRight,
      y,
    );
    context.strokeStyle = `rgba(125, 180, 255, ${0.045 + (line % 2) * 0.025})`;
    context.stroke();
  }
  for (let line = 0; line < 12; line += 1) {
    const progress = line / 11;
    const x = regionLeft + progress * (regionRight - regionLeft);
    context.beginPath();
    context.moveTo(x, regionTop);
    context.lineTo(x, regionBottom);
    context.strokeStyle = `rgba(255, 184, 107, ${0.025 + (line % 3) * 0.015})`;
    context.stroke();
  }

  [leftWell, rightWell].forEach((x, index) => {
    const color = index === 0 ? COLORS.amber : COLORS.blue;
    for (let ring = 3; ring >= 0; ring -= 1) {
      context.beginPath();
      context.ellipse(x, wellY, wellRadius * (0.42 + ring * 0.18), wellRadius * (0.2 + ring * 0.085), 0, 0, TAU);
      context.strokeStyle = color.replace(")", "");
      context.globalAlpha = 0.08 + (3 - ring) * 0.045;
      context.lineWidth = ring === 0 ? 2 : 1;
      context.stroke();
    }
  });
  context.globalAlpha = 1;

  const midpoint = (leftWell + rightWell) / 2;
  const leftAtomX = leftWell + (midpoint - wellRadius * 0.17 - leftWell) * collision;
  const rightAtomX = rightWell + (midpoint + wellRadius * 0.17 - rightWell) * collision;
  const bobLift = Math.sin(phase) * (compact ? 7 : 11);
  const ambientPulse = reducedMotion ? 0 : Math.sin(timestamp * 0.004) * 1.4;

  if (simulation.concurrence > 0.001) {
    context.beginPath();
    context.moveTo(leftAtomX, wellY);
    context.bezierCurveTo(midpoint, wellY - 34, midpoint, wellY + 34, rightAtomX, wellY + bobLift);
    context.lineWidth = 1.5 + simulation.concurrence * 3;
    context.strokeStyle = `rgba(95, 232, 196, ${0.16 + simulation.concurrence * 0.64})`;
    context.shadowBlur = 18;
    context.shadowColor = COLORS.mint;
    context.stroke();
    context.shadowBlur = 0;
  }

  const atoms = [
    { x: leftAtomX, y: wellY, color: COLORS.amber, axis: state.aliceAxis, label: "ALICE" },
    { x: rightAtomX, y: wellY + bobLift, color: COLORS.blue, axis: state.bobAxis, label: "BOB" },
  ];
  atoms.forEach(({ x, y, color, axis, label }, index) => {
    const radius = (compact ? 8 : 10) + ambientPulse;
    const atomGlow = context.createRadialGradient(x, y, 0, x, y, radius * 3.2);
    atomGlow.addColorStop(0, color);
    atomGlow.addColorStop(0.24, `${color}bb`);
    atomGlow.addColorStop(1, `${color}00`);
    context.fillStyle = atomGlow;
    context.beginPath();
    context.arc(x, y, radius * 3.2, 0, TAU);
    context.fill();
    context.fillStyle = COLORS.cream;
    context.beginPath();
    context.arc(x, y, radius * 0.54, 0, TAU);
    context.fill();

    const axisRadians = -axis * DEG_TO_RAD - Math.PI / 2;
    const axisLength = compact ? 18 : 23;
    context.beginPath();
    context.moveTo(x - Math.cos(axisRadians) * axisLength, y - Math.sin(axisRadians) * axisLength);
    context.lineTo(x + Math.cos(axisRadians) * axisLength, y + Math.sin(axisRadians) * axisLength);
    context.strokeStyle = color;
    context.lineWidth = 1.4;
    context.stroke();
    context.fillStyle = "rgba(255, 243, 214, 0.66)";
    context.font = `${compact ? 8 : 9}px ui-monospace, SFMono-Regular, Menlo, monospace`;
    context.textAlign = index === 0 ? "right" : "left";
    context.fillText(
      `${label} · ${axisLabel(axis, false)}`,
      x + (index === 0 ? -12 : 12),
      y + wellRadius * 0.68,
    );

    if (state.lastOutcome) {
      context.fillStyle = color;
      context.font = `600 ${compact ? 12 : 14}px ui-monospace, SFMono-Regular, Menlo, monospace`;
      context.fillText(state.lastOutcome[index], x, y - wellRadius * 0.56);
    }
  });

  context.fillStyle = "rgba(255, 243, 214, 0.46)";
  context.font = `${compact ? 8 : 9}px ui-monospace, SFMono-Regular, Menlo, monospace`;
  context.textAlign = "center";
  context.fillText("OPTICAL DOUBLE WELL · CONTROLLED COLLISION", midpoint, regionBottom + 20);
  context.restore();
}

function drawProbabilityFlower(context, layout, timestamp) {
  const { flowerX: centerX, flowerY: centerY, flowerRadius, compact } = layout;
  const directions = [-Math.PI * 0.75, -Math.PI * 0.25, Math.PI * 0.75, Math.PI * 0.25];
  const flashing = timestamp < state.measurementFlashUntil;
  context.save();
  context.globalCompositeOperation = "lighter";

  simulation.probabilities.forEach((probability, index) => {
    const direction = directions[index];
    const rootProbability = Math.sqrt(probability);
    const petalLength = flowerRadius * (0.24 + rootProbability * 0.68);
    const petalWidth = flowerRadius * (0.1 + rootProbability * 0.23);
    const petalX = centerX + Math.cos(direction) * petalLength * 0.48;
    const petalY = centerY + Math.sin(direction) * petalLength * 0.48;
    const highlight = flashing && state.lastOutcome === BELL_SQUARE_OUTCOMES[index];

    context.save();
    context.translate(petalX, petalY);
    context.rotate(direction);
    context.shadowBlur = highlight ? 34 : 18;
    context.shadowColor = OUTCOME_COLORS[index];
    const gradient = context.createRadialGradient(0, 0, 0, 0, 0, petalLength);
    gradient.addColorStop(0, `${OUTCOME_COLORS[index]}ee`);
    gradient.addColorStop(0.5, `${OUTCOME_COLORS[index]}55`);
    gradient.addColorStop(1, `${OUTCOME_COLORS[index]}00`);
    context.fillStyle = gradient;
    context.beginPath();
    context.ellipse(0, 0, Math.max(4, petalLength), Math.max(2.5, petalWidth), 0, 0, TAU);
    context.fill();
    context.restore();
  });

  context.globalCompositeOperation = "source-over";
  context.beginPath();
  context.arc(centerX, centerY, compact ? 6 : 8, 0, TAU);
  context.fillStyle = COLORS.cream;
  context.shadowBlur = 16;
  context.shadowColor = COLORS.cream;
  context.fill();
  context.shadowBlur = 0;

  simulation.probabilities.forEach((probability, index) => {
    const direction = directions[index];
    const labelDistance = flowerRadius * 0.94;
    const x = centerX + Math.cos(direction) * labelDistance;
    const y = centerY + Math.sin(direction) * labelDistance;
    context.fillStyle = OUTCOME_COLORS[index];
    context.font = `600 ${compact ? 9 : 11}px ui-monospace, SFMono-Regular, Menlo, monospace`;
    context.textAlign = "center";
    context.fillText(BELL_SQUARE_OUTCOMES[index], x, y - 2);
    context.fillStyle = "rgba(255, 243, 214, 0.66)";
    context.font = `${compact ? 7 : 9}px ui-monospace, SFMono-Regular, Menlo, monospace`;
    context.fillText(percentage(probability, 0), x, y + (compact ? 9 : 12));
  });
  context.fillStyle = "rgba(255, 243, 214, 0.46)";
  context.font = `${compact ? 8 : 9}px ui-monospace, SFMono-Regular, Menlo, monospace`;
  context.textAlign = "center";
  context.fillText("JOINT STATE FLOWER", centerX, centerY + flowerRadius * 1.12);
  context.restore();
}

function drawCorrelationMatrix(context, layout, timestamp) {
  const { matrixX, matrixY, matrixCell, compact } = layout;
  const flashing = timestamp < state.measurementFlashUntil;
  const gap = compact ? 3 : 5;
  const matrixSize = matrixCell * 2 + gap;
  context.save();
  context.fillStyle = "rgba(255, 243, 214, 0.46)";
  context.font = `${compact ? 8 : 9}px ui-monospace, SFMono-Regular, Menlo, monospace`;
  context.textAlign = "left";
  context.fillText(`CORRELATION ${signed(simulation.correlation)}`, matrixX, matrixY - 24);
  context.fillStyle = "rgba(255, 243, 214, 0.34)";
  context.fillText("BOB →", matrixX, matrixY - 10);

  simulation.probabilities.forEach((probability, index) => {
    const row = Math.floor(index / 2);
    const column = index % 2;
    const x = matrixX + column * (matrixCell + gap);
    const y = matrixY + row * (matrixCell + gap);
    const outcome = BELL_SQUARE_OUTCOMES[index];
    const highlight = flashing && state.lastOutcome === outcome;
    roundedRect(context, x, y, matrixCell, matrixCell, compact ? 4 : 7);
    context.fillStyle = `${OUTCOME_COLORS[index]}${Math.round((0.12 + probability * 0.72) * 255).toString(16).padStart(2, "0")}`;
    context.fill();
    context.lineWidth = highlight ? 2.5 : 1;
    context.strokeStyle = highlight ? COLORS.cream : `${OUTCOME_COLORS[index]}88`;
    context.shadowBlur = highlight ? 20 : 0;
    context.shadowColor = OUTCOME_COLORS[index];
    context.stroke();
    context.shadowBlur = 0;
    context.fillStyle = probability > 0.42 ? COLORS.ink : COLORS.cream;
    context.font = `600 ${compact ? 9 : 11}px ui-monospace, SFMono-Regular, Menlo, monospace`;
    context.textAlign = "center";
    context.fillText(outcome, x + matrixCell / 2, y + matrixCell * 0.45);
    context.font = `${compact ? 7 : 9}px ui-monospace, SFMono-Regular, Menlo, monospace`;
    context.fillText(percentage(probability, 0), x + matrixCell / 2, y + matrixCell * 0.68);
  });

  context.save();
  context.translate(matrixX - 12, matrixY + matrixSize);
  context.rotate(-Math.PI / 2);
  context.fillStyle = "rgba(255, 243, 214, 0.34)";
  context.font = `${compact ? 8 : 9}px ui-monospace, SFMono-Regular, Menlo, monospace`;
  context.textAlign = "left";
  context.fillText("ALICE →", 0, 0);
  context.restore();
  context.restore();
}

function stageLayout(width, height) {
  const compact = width < 720;
  if (compact) {
    const wellRadius = clamp(width * 0.17, 44, 74);
    return {
      compact,
      leftWell: width * 0.31,
      rightWell: width * 0.69,
      wellY: height * 0.37,
      wellRadius,
      flowerX: width * 0.3,
      flowerY: height * 0.69,
      flowerRadius: clamp(Math.min(width, height) * 0.13, 38, 64),
      matrixX: width * 0.61,
      matrixY: height * 0.62,
      matrixCell: clamp(width * 0.105, 34, 50),
    };
  }
  return {
    compact,
    leftWell: width * 0.22,
    rightWell: width * 0.43,
    wellY: height * 0.52,
    wellRadius: clamp(Math.min(width, height) * 0.13, 68, 108),
    flowerX: width * 0.7,
    flowerY: height * 0.43,
    flowerRadius: clamp(Math.min(width, height) * 0.16, 72, 122),
    matrixX: width * 0.61,
    matrixY: height * 0.68,
    matrixCell: clamp(Math.min(width, height) * 0.085, 48, 72),
  };
}

function draw(timestamp) {
  if (!context2d) return;
  const layout = stageLayout(cssWidth, cssHeight);
  context2d.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
  drawBackground(context2d, cssWidth, cssHeight, timestamp);
  drawOpticalLattice(context2d, layout, timestamp);
  drawProbabilityFlower(context2d, layout, timestamp);
  drawCorrelationMatrix(context2d, layout, timestamp);

  if (!layout.compact) {
    context2d.fillStyle = "rgba(255, 243, 214, 0.31)";
    context2d.font = "9px ui-monospace, SFMono-Regular, Menlo, monospace";
    context2d.textAlign = "center";
    context2d.fillText(
      "EXACT TWO-QUBIT CLASSICAL SIMULATION · NO QPU CONNECTION",
      cssWidth / 2,
      cssHeight - 68,
    );
  }
}

function animationFrame(timestamp) {
  frameId = null;
  if (disposed || !pageActive || document.hidden) return;
  const elapsedSeconds = lastFrameTime > 0 ? Math.min(0.1, (timestamp - lastFrameTime) / 1_000) : 0;
  lastFrameTime = timestamp;

  if (state.playing && elapsedSeconds > 0) {
    const danceRate = reducedMotion ? 18 : 38;
    state.collisionPhase = (state.collisionPhase + elapsedSeconds * danceRate) % 360;
    simulation = calculateSimulation();
    updateReadouts();
    updateAudioVoices();
    visualizationDirty = true;
  }

  const flashActive = timestamp < state.measurementFlashUntil;
  if (visualizationDirty || timestamp - lastDrawTime >= DRAW_INTERVAL) {
    draw(timestamp);
    lastDrawTime = timestamp;
    visualizationDirty = false;
  }
  if (state.playing || flashActive) scheduleVisualization();
}

function scheduleVisualization() {
  if (frameId === null && pageActive && !document.hidden && !disposed) {
    frameId = requestAnimationFrame(animationFrame);
  }
}

function resizeCanvas() {
  const bounds = stageWrap.getBoundingClientRect();
  cssWidth = Math.max(1, Math.round(bounds.width));
  cssHeight = Math.max(1, Math.round(bounds.height));
  pixelRatio = Math.min(1.5, Math.max(1, globalThis.devicePixelRatio || 1));
  const width = Math.round(cssWidth * pixelRatio);
  const height = Math.round(cssHeight * pixelRatio);
  if (canvas.width !== width || canvas.height !== height) {
    canvas.width = width;
    canvas.height = height;
    canvas.style.width = `${cssWidth}px`;
    canvas.style.height = `${cssHeight}px`;
  }
  visualizationDirty = true;
  scheduleVisualization();
}

$("audioButton").addEventListener("click", toggleAudio);
$("playButton").addEventListener("click", togglePlaying);
$("measureButton").addEventListener("click", () => performMeasurement(1));
$("shotsButton").addEventListener("click", () => performMeasurement(32));
$("resetBellSquare").addEventListener("click", resetInstrument);

$("collisionPhase").addEventListener("input", (event) => {
  state.collisionPhase = clamp(Number(event.currentTarget.value), 0, 360);
  refreshSimulation();
});
$("collisionPhase").addEventListener("change", () => {
  announce(`Controlled phase ${phaseLabel(state.collisionPhase)}. ${entanglementLabel(simulation.concurrence)}.`);
});

for (const [id, key, party] of [
  ["aliceAxis", "aliceAxis", "Alice"],
  ["bobAxis", "bobAxis", "Bob"],
]) {
  $(id).addEventListener("input", (event) => {
    state[key] = clamp(Number(event.currentTarget.value), -180, 180);
    refreshSimulation();
  });
  $(id).addEventListener("change", () => {
    announce(`${party} measurement axis ${axisLabel(state[key])}. Correlation ${signed(simulation.correlation)}.`);
  });
}

$("dephasing").addEventListener("input", (event) => {
  state.dephasing = clamp(Number(event.currentTarget.value), 0, 1);
  refreshSimulation();
});
$("dephasing").addEventListener("change", () => {
  announce(`Local dephasing ${percentage(state.dephasing, 0)}. Concurrence ${simulation.concurrence.toFixed(3)}; global purity ${simulation.globalPurity.toFixed(3)}.`);
});

$("level").addEventListener("input", (event) => {
  state.level = clamp(Number(event.currentTarget.value), 0, 0.82);
  voices.setLevel(state.level);
  $("levelOut").textContent = percentage(state.level, 0);
});

function isTypingTarget(target) {
  return target instanceof HTMLElement && (
    target.matches("input, select, textarea, button, a") || target.isContentEditable
  );
}

globalThis.addEventListener("keydown", (event) => {
  if (event.key === "Escape") {
    turnAudioOff();
    return;
  }
  if (isTypingTarget(event.target)) return;
  if (event.key === " ") {
    event.preventDefault();
    togglePlaying();
    return;
  }
  if (event.key.toLowerCase() === "m") {
    event.preventDefault();
    performMeasurement(1);
    return;
  }
  if (!["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)) return;
  event.preventDefault();
  const direction = event.key === "ArrowRight" || event.key === "ArrowUp" ? 1 : -1;
  const step = event.shiftKey ? 1 : 5;
  setCollisionPhase(state.collisionPhase + direction * step, { announceChange: true });
});

const resizeObserver = typeof ResizeObserver === "function" ? new ResizeObserver(resizeCanvas) : null;
resizeObserver?.observe(stageWrap);
if (!resizeObserver) globalThis.addEventListener("resize", resizeCanvas);

document.addEventListener("visibilitychange", () => {
  if (!document.hidden) {
    lastFrameTime = performance.now();
    visualizationDirty = true;
    scheduleVisualization();
  }
});

globalThis.addEventListener("pagehide", (event) => {
  pageActive = false;
  audioRequest += 1;
  state.playing = false;
  state.audioOn = false;
  state.audioStarting = false;
  voices.disable();
  if (frameId !== null) cancelAnimationFrame(frameId);
  frameId = null;
  if (event.persisted) return;
  disposed = true;
  resizeObserver?.disconnect();
  if (!resizeObserver) globalThis.removeEventListener("resize", resizeCanvas);
  void voices.close();
});

globalThis.addEventListener("pageshow", (event) => {
  if (!event.persisted || disposed) return;
  pageActive = true;
  lastFrameTime = performance.now();
  updateTransport();
  updateAudioInterface();
  updateReadouts();
  visualizationDirty = true;
  scheduleVisualization();
});

voices.setLevel(state.level);
updateTransport();
updateAudioInterface();
refreshSimulation();
resizeCanvas();

import {
  VoicePool,
  clamp,
  synthParametersForMode,
} from "./src/audio.js";
import {
  ANNEALOGUE_DEFAULTS,
  ANNEALOGUE_LANDSCAPES,
  bitstring,
  classicalGreedyDescent,
  complexAmplitudes,
  evolveSchedule,
  expectedEnergy,
  measureState,
  simulateAnneal,
  stateProbabilities,
  successProbability,
} from "./src/annealogue.js";

const $ = (id) => document.getElementById(id);
const canvas = $("stage");
const stageWrap = $("stageWrap");
const context = canvas.getContext("2d");
const pool = new VoicePool(8);
const DEFAULT_OUTPUT = 0.44;
const reducedMotionQuery = globalThis.matchMedia?.("(prefers-reduced-motion: reduce)");

const state = {
  landscapeId: ANNEALOGUE_DEFAULTS.landscapeId,
  durationSeconds: ANNEALOGUE_DEFAULTS.durationSeconds,
  gamma: ANNEALOGUE_DEFAULTS.gamma,
  progress: 0,
  amplitudes: null,
  playing: false,
  audioOn: false,
  audioStarting: false,
  output: DEFAULT_OUTPUT,
  measurement: null,
  reducedMotion: reducedMotionQuery?.matches ?? false,
};

let cssWidth = 1;
let cssHeight = 1;
let pixelRatio = 1;
let frameRequest = 0;
let lastFrameTime = null;
let audioRequest = 0;
let pageActive = true;

function activeLandscape() {
  return ANNEALOGUE_LANDSCAPES[state.landscapeId];
}

function setPressed(element, pressed) {
  element.setAttribute("aria-pressed", String(Boolean(pressed)));
}

function announce(message) {
  $("liveStatus").textContent = message;
}

function resizeCanvas() {
  const bounds = stageWrap.getBoundingClientRect();
  cssWidth = Math.max(1, Math.round(bounds.width));
  cssHeight = Math.max(1, Math.round(bounds.height));
  pixelRatio = Math.max(1, Math.min(
    globalThis.devicePixelRatio || 1,
    2,
    Math.sqrt(3_000_000 / Math.max(1, cssWidth * cssHeight)),
  ));
  const width = Math.round(cssWidth * pixelRatio);
  const height = Math.round(cssHeight * pixelRatio);
  if (canvas.width !== width) canvas.width = width;
  if (canvas.height !== height) canvas.height = height;
}

function requestFrame() {
  if (!frameRequest && pageActive) frameRequest = requestAnimationFrame(frame);
}

function formatPercent(value, digits = 1) {
  return (clamp(value, 0, 1) * 100).toFixed(digits) + "%";
}

function formatPath(path) {
  return path.map(bitstring).join(" → ");
}

function energyRange(energies) {
  const minimum = Math.min(...energies);
  const maximum = Math.max(...energies);
  return { minimum, maximum, span: Math.max(1e-9, maximum - minimum) };
}

function bitCount(value) {
  let count = 0;
  for (let bits = value; bits; bits >>>= 1) count += bits & 1;
  return count;
}

function voicesForState() {
  const landscape = activeLandscape();
  const probabilities = stateProbabilities(state.amplitudes);
  const range = energyRange(landscape.energies);
  const spread = 0.45 + state.gamma * 1.15;
  return Array.from(probabilities, (probability, index) => {
    const energyPosition = (landscape.energies[index] - range.minimum) / range.span;
    const centeredIndex = index - 3.5;
    const semitones = centeredIndex * spread + energyPosition * 5;
    const frequency = 110 * 2 ** (semitones / 12);
    const probabilityWeight = Math.sqrt(probability);
    return {
      key: "basis-" + index,
      frequency,
      gain: 0.36 * probabilityWeight,
      pan: (bitCount(index) - 1.5) / 1.7,
      waveform: energyPosition > 0.7 ? "triangle" : "sine",
      gainSmoothingSeconds: state.reducedMotion ? 0.06 : 0.025,
      ...synthParametersForMode("fm", energyPosition * 0.5, {
        fmIndex: 1 + state.gamma * 0.7,
        fmRatio: 1.5 + index * 0.125,
      }),
    };
  });
}

function updateAudioVoices() {
  pool.setVoices(voicesForState(), {
    mode: "fm",
    requestedVoiceCount: 8,
    voiceLimit: 8,
  });
}

function measurementVoice(index) {
  const voice = voicesForState()[index];
  return {
    ...voice,
    key: "measurement-" + index,
    gain: 0.5,
    waveform: activeLandscape().energies[index] > Math.min(...activeLandscape().energies)
      ? "triangle"
      : "sine",
  };
}

function updateAudioUi() {
  setPressed($("audioButton"), state.audioOn);
  $("audioButton").disabled = state.audioStarting;
  $("audioState").textContent = state.audioOn ? "on" : "off";
}

function updateUi() {
  const landscape = activeLandscape();
  const greedy = classicalGreedyDescent(landscape.energies, landscape.greedyStart);
  const energy = expectedEnergy(state.amplitudes, landscape.energies);
  const success = successProbability(state.amplitudes, landscape.energies);
  const activeStates = Array.from(stateProbabilities(state.amplitudes))
    .filter((probability) => probability > 0.0005).length;

  $("landscape").value = state.landscapeId;
  $("landscapeSummary").textContent = landscape.name;
  $("landscapeDescription").textContent = landscape.description;

  $("duration").value = String(state.durationSeconds);
  $("durationOut").textContent = state.durationSeconds.toFixed(1) + " s";
  $("duration").setAttribute("aria-valuetext", state.durationSeconds.toFixed(1) + " seconds");
  $("gamma").value = String(state.gamma);
  $("gammaOut").textContent = state.gamma.toFixed(2);
  $("gamma").setAttribute("aria-valuetext", "Gamma " + state.gamma.toFixed(2));
  $("progress").value = String(state.progress);
  $("progressOut").textContent = formatPercent(state.progress);
  $("progress").setAttribute("aria-valuetext", "Schedule " + formatPercent(state.progress));

  setPressed($("playButton"), state.playing);
  $("playButton").setAttribute(
    "aria-label",
    state.playing
      ? "Pause annealing schedule"
      : state.progress >= 1
        ? "Replay annealing schedule"
        : "Play annealing schedule",
  );
  $("scheduleSummary").textContent = (
    state.playing ? "running" : state.progress >= 1 ? "complete · replay" : "paused"
  ) + " · s " + state.progress.toFixed(3);

  $("expectedEnergy").textContent = energy.toFixed(3);
  $("successProbability").textContent = formatPercent(success);
  $("measurementReadout").textContent = state.measurement
    ? "|" + state.measurement.bitstring + "> · prior " + formatPercent(state.measurement.probability)
    : "not measured";
  $("greedyReadout").textContent = formatPath(greedy.path)
    + (greedy.reachedGround ? " · ground" : " · stuck above ground");
  $("stateSummary").textContent = state.measurement
    ? "collapsed to |" + state.measurement.bitstring + ">"
    : activeStates + " coherent amplitude" + (activeStates === 1 ? "" : "s");

  $("stageReadout").textContent = "S " + state.progress.toFixed(3)
    + " · SUCCESS " + formatPercent(success)
    + " · AUDIO " + (state.audioOn ? "ON" : "OFF");
  canvas.setAttribute(
    "aria-label",
    "Annealogue " + landscape.name + " three-qubit energy landscape. Schedule "
      + formatPercent(state.progress) + ", ground-state success " + formatPercent(success)
      + (state.measurement ? ", measured " + state.measurement.bitstring : "")
      + ". Audio " + (state.audioOn ? "on." : "off."),
  );
  $("output").value = String(state.output);
  $("outputOut").textContent = Math.round(state.output * 100) + "%";
  updateAudioUi();
}

function vertexPositions(energies) {
  const range = energyRange(energies);
  const compact = cssHeight < 330;
  const horizontal = Math.min(cssWidth * 0.17, compact ? 92 : 150);
  const depth = Math.min(cssWidth * 0.105, compact ? 52 : 92);
  const layerShift = Math.min(cssWidth * 0.038, compact ? 20 : 34);
  const centerX = cssWidth * (cssWidth < 700 ? 0.52 : 0.53);
  const floorY = cssHeight * (compact ? 0.77 : 0.76);
  const heightScale = cssHeight * (compact ? 0.37 : 0.44);
  return energies.map((energy, index) => {
    const xBit = index & 1 ? 1 : -1;
    const depthBit = index & 2 ? 1 : -1;
    const layerBit = index & 4 ? 1 : -1;
    const energyPosition = (energy - range.minimum) / range.span;
    return {
      index,
      x: centerX + xBit * horizontal + depthBit * depth + layerBit * layerShift,
      y: floorY - energyPosition * heightScale + depthBit * (compact ? 9 : 16)
        - layerBit * (compact ? 3 : 7),
      energy,
      energyPosition,
    };
  });
}

function canvasColors() {
  const styles = getComputedStyle(document.body);
  return {
    background: styles.getPropertyValue("--bg-deep").trim() || "#050608",
    ink: styles.getPropertyValue("--ink").trim() || "#dbe4e0",
    muted: styles.getPropertyValue("--muted").trim() || "#77837e",
    faint: styles.getPropertyValue("--faint").trim() || "#454e4b",
    line: styles.getPropertyValue("--line-strong").trim() || "rgba(214,232,226,.18)",
    accent: styles.getPropertyValue("--accent").trim() || "#c79bff",
    amber: styles.getPropertyValue("--brass").trim() || "#e8c46b",
    blue: styles.getPropertyValue("--blue").trim() || "#7db4ff",
  };
}

function drawGrid(colors) {
  const spacing = 44;
  context.save();
  context.lineWidth = 1;
  context.strokeStyle = "rgba(214,232,226,0.025)";
  context.beginPath();
  for (let x = spacing / 2; x < cssWidth; x += spacing) {
    context.moveTo(x, 0);
    context.lineTo(x, cssHeight);
  }
  for (let y = spacing / 2; y < cssHeight; y += spacing) {
    context.moveTo(0, y);
    context.lineTo(cssWidth, y);
  }
  context.stroke();

  const glow = context.createRadialGradient(
    cssWidth * 0.53,
    cssHeight * 0.53,
    0,
    cssWidth * 0.53,
    cssHeight * 0.53,
    Math.max(cssWidth, cssHeight) * 0.58,
  );
  glow.addColorStop(0, "rgba(199,155,255,0.07)");
  glow.addColorStop(0.58, "rgba(125,180,255,0.025)");
  glow.addColorStop(1, "rgba(5,6,8,0)");
  context.fillStyle = glow;
  context.fillRect(0, 0, cssWidth, cssHeight);
  context.restore();
}

function drawLandscape() {
  const landscape = activeLandscape();
  const probabilities = stateProbabilities(state.amplitudes);
  const amplitudes = complexAmplitudes(state.amplitudes);
  const positions = vertexPositions(landscape.energies);
  const greedy = classicalGreedyDescent(landscape.energies, landscape.greedyStart);
  const colors = canvasColors();
  const compact = cssHeight < 330;
  const pulse = state.reducedMotion ? 0 : Math.sin(performance.now() * 0.0025) * 1.5;

  context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
  context.clearRect(0, 0, cssWidth, cssHeight);
  drawGrid(colors);

  // Problem-energy stems make vertical position explicit even when cube depth
  // offsets two otherwise equal-energy vertices.
  const floorY = cssHeight * (compact ? 0.82 : 0.81);
  context.save();
  context.setLineDash([2, 5]);
  context.strokeStyle = "rgba(125,180,255,0.17)";
  context.lineWidth = 1;
  for (const vertex of positions) {
    context.beginPath();
    context.moveTo(vertex.x, floorY);
    context.lineTo(vertex.x, vertex.y);
    context.stroke();
  }
  context.restore();

  // The 12 edges connect exactly the bitstrings separated by one bit. Their
  // brightness is the remaining transverse-driver strength.
  const driverStrength = clamp((1 - state.progress) * state.gamma / 3, 0, 1);
  context.save();
  context.strokeStyle = "rgba(199,155,255," + (0.12 + driverStrength * 0.5).toFixed(3) + ")";
  context.lineWidth = 0.8 + driverStrength * 1.8;
  for (let index = 0; index < 8; index += 1) {
    for (let qubit = 0; qubit < 3; qubit += 1) {
      const peer = index ^ (1 << qubit);
      if (peer < index) continue;
      context.beginPath();
      context.moveTo(positions[index].x, positions[index].y);
      context.lineTo(positions[peer].x, positions[peer].y);
      context.stroke();
    }
  }
  context.restore();

  // A separate classical comparator walks downhill along single-bit edges.
  context.save();
  context.strokeStyle = colors.amber;
  context.lineWidth = compact ? 1.5 : 2;
  context.setLineDash([7, 5]);
  context.beginPath();
  greedy.path.forEach((index, pathIndex) => {
    const point = positions[index];
    if (pathIndex === 0) context.moveTo(point.x, point.y);
    else context.lineTo(point.x, point.y);
  });
  context.stroke();
  context.setLineDash([]);
  for (const index of greedy.path) {
    const point = positions[index];
    context.beginPath();
    context.arc(point.x, point.y, compact ? 7 : 9, 0, Math.PI * 2);
    context.stroke();
  }
  context.restore();

  const groundEnergy = Math.min(...landscape.energies);
  for (const vertex of positions) {
    const probability = probabilities[vertex.index];
    const amplitude = amplitudes[vertex.index];
    const radius = (compact ? 5 : 6) + Math.sqrt(probability) * (compact ? 23 : 34) + pulse;
    const isGround = Math.abs(vertex.energy - groundEnergy) < 1e-9;
    const isMeasured = state.measurement?.index === vertex.index;

    if (probability > 0.00001) {
      const halo = context.createRadialGradient(
        vertex.x,
        vertex.y,
        1,
        vertex.x,
        vertex.y,
        Math.max(3, radius),
      );
      halo.addColorStop(0, isMeasured ? "rgba(255,243,214,0.72)" : "rgba(199,155,255,0.48)");
      halo.addColorStop(0.3, isGround ? "rgba(95,232,196,0.25)" : "rgba(125,180,255,0.18)");
      halo.addColorStop(1, "rgba(199,155,255,0)");
      context.fillStyle = halo;
      context.beginPath();
      context.arc(vertex.x, vertex.y, radius, 0, Math.PI * 2);
      context.fill();
    }

    context.fillStyle = colors.background;
    context.strokeStyle = isGround ? colors.accent : colors.blue;
    context.lineWidth = isMeasured ? 2.5 : 1.2;
    context.beginPath();
    context.arc(vertex.x, vertex.y, isMeasured ? 6 : 4, 0, Math.PI * 2);
    context.fill();
    context.stroke();

    if (probability > 0.00001) {
      const phase = Math.atan2(amplitude.im, amplitude.re);
      const inner = compact ? 7 : 9;
      const outer = inner + (compact ? 7 : 10);
      context.strokeStyle = colors.ink;
      context.lineWidth = 1.3;
      context.beginPath();
      context.moveTo(
        vertex.x + Math.cos(phase) * inner,
        vertex.y + Math.sin(phase) * inner,
      );
      context.lineTo(
        vertex.x + Math.cos(phase) * outer,
        vertex.y + Math.sin(phase) * outer,
      );
      context.stroke();
    }

    context.font = (compact ? "8px " : "10px ") + "ui-monospace, monospace";
    context.textAlign = "center";
    context.fillStyle = isGround ? colors.accent : colors.ink;
    context.fillText(bitstring(vertex.index), vertex.x, vertex.y - radius - 4);
    if (!compact) {
      context.font = "8px ui-monospace, monospace";
      context.fillStyle = colors.muted;
      context.fillText(
        "E " + vertex.energy.toFixed(2) + " · p " + formatPercent(probability),
        vertex.x,
        vertex.y + radius + 12,
      );
    }
  }

  // Canvas-local legend and caveat remain visible if overlay styling fails.
  context.save();
  context.font = (compact ? "7px " : "8px ") + "ui-monospace, monospace";
  context.textAlign = "left";
  context.fillStyle = colors.muted;
  // Leave a clear lane for the HTML simulation notice pinned to the bottom.
  const legendY = compact ? cssHeight - 76 : cssHeight - 90;
  context.fillText("HEIGHT  E(z)   ·   HALO  |a(z)|²   ·   TICK  phase   ·   AMBER  greedy", 18, legendY);
  context.fillStyle = colors.faint;
  context.fillText("EXACT 3-QUBIT CLASSICAL SIMULATION · NO QPU · NO SPEEDUP CLAIM", 18, legendY + 16);
  context.restore();
}

function recomputeAtProgress(progress, { announceChange = false } = {}) {
  state.playing = false;
  state.progress = clamp(progress, 0, 1);
  state.amplitudes = simulateAnneal({
    landscape: state.landscapeId,
    gamma: state.gamma,
    durationSeconds: state.durationSeconds,
    progress: state.progress,
  });
  state.measurement = null;
  lastFrameTime = null;
  updateAudioVoices();
  updateUi();
  requestFrame();
  if (announceChange) announce("Schedule moved to " + formatPercent(state.progress) + ".");
}

function restart({ announceChange = true } = {}) {
  recomputeAtProgress(0);
  if (announceChange) announce("Annealing schedule restarted at the uniform driver state.");
}

function togglePlayback() {
  if (state.playing) {
    state.playing = false;
    lastFrameTime = null;
    updateUi();
    drawLandscape();
    announce("Annealing schedule paused at " + formatPercent(state.progress) + ".");
    return;
  }
  const replaying = state.progress >= 1;
  if (replaying) restart({ announceChange: false });
  state.playing = true;
  lastFrameTime = null;
  updateUi();
  requestFrame();
  announce(replaying ? "Replaying the annealing schedule." : "Annealing schedule playing.");
}

function performMeasurement() {
  const landscape = activeLandscape();
  const result = measureState(state.amplitudes);
  const wasGround = Math.abs(
    landscape.energies[result.index] - Math.min(...landscape.energies),
  ) < 1e-9;
  state.playing = false;
  state.amplitudes = result.collapsedState;
  state.measurement = result;
  lastFrameTime = null;
  updateAudioVoices();
  if (state.audioOn) {
    pool.strike(measurementVoice(result.index), {
      attackSeconds: 0.006,
      decaySeconds: 0.7,
      attackNoise: 0.04,
    });
  }
  updateUi();
  drawLandscape();
  announce(
    "Measured " + result.bitstring + " with prior probability "
      + formatPercent(result.probability) + (wasGround ? "; a ground state." : "; above ground."),
  );
}

function frame(timestamp) {
  frameRequest = 0;
  if (!pageActive) return;
  resizeCanvas();
  if (state.playing) {
    if (lastFrameTime === null) lastFrameTime = timestamp;
    const elapsedSeconds = clamp((timestamp - lastFrameTime) / 1000, 0, 0.08);
    lastFrameTime = timestamp;
    const nextProgress = clamp(
      state.progress + elapsedSeconds / state.durationSeconds,
      0,
      1,
    );
    if (nextProgress > state.progress) {
      state.amplitudes = evolveSchedule(state.amplitudes, {
        energies: activeLandscape().energies,
        gamma: state.gamma,
        durationSeconds: state.durationSeconds,
        fromProgress: state.progress,
        toProgress: nextProgress,
      });
      state.progress = nextProgress;
      state.measurement = null;
      updateAudioVoices();
    }
    if (state.progress >= 1) {
      state.playing = false;
      lastFrameTime = null;
      announce(
        "Anneal complete. Ground-state success probability "
          + formatPercent(successProbability(state.amplitudes, activeLandscape().energies)) + ".",
      );
    }
  }
  updateUi();
  drawLandscape();
  if (state.playing) requestFrame();
}

async function toggleAudio() {
  if (state.audioOn) {
    audioRequest += 1;
    state.audioOn = false;
    pool.disable();
    updateAudioUi();
    updateUi();
    drawLandscape();
    announce("Audio off.");
    return;
  }

  const request = ++audioRequest;
  state.audioStarting = true;
  $("audioError").hidden = true;
  updateAudioUi();
  try {
    // This call occurs only inside the Audio button's explicit click gesture.
    await pool.enable();
    if (!pageActive || request !== audioRequest) {
      pool.disable();
      return;
    }
    state.audioOn = true;
    pool.setLevel(state.output);
    updateAudioVoices();
    announce("Audio on. Eight probability-weighted voices are active.");
  } catch (error) {
    state.audioOn = false;
    pool.disable();
    $("audioError").textContent = error instanceof Error
      ? error.message
      : "Audio could not be started.";
    $("audioError").hidden = false;
    announce("Audio could not be started.");
  } finally {
    if (request === audioRequest) state.audioStarting = false;
    updateAudioUi();
    updateUi();
    drawLandscape();
  }
}

$("audioButton").addEventListener("click", () => void toggleAudio());
$("playButton").addEventListener("click", togglePlayback);
$("restartButton").addEventListener("click", () => restart());
$("stepButton").addEventListener("click", () => {
  recomputeAtProgress(state.progress + 0.01, { announceChange: true });
});
$("measureButton").addEventListener("click", performMeasurement);

$("landscape").addEventListener("change", (event) => {
  state.landscapeId = event.currentTarget.value;
  restart({ announceChange: false });
  announce(activeLandscape().name + " landscape loaded. " + activeLandscape().description);
});

$("progress").addEventListener("input", (event) => {
  recomputeAtProgress(Number(event.currentTarget.value));
});
$("progress").addEventListener("change", () => {
  announce("Schedule scrubbed to " + formatPercent(state.progress) + ".");
});

$("duration").addEventListener("input", (event) => {
  state.durationSeconds = Number(event.currentTarget.value);
  recomputeAtProgress(state.progress);
});
$("gamma").addEventListener("input", (event) => {
  state.gamma = Number(event.currentTarget.value);
  recomputeAtProgress(state.progress);
});

$("output").addEventListener("input", (event) => {
  state.output = Number(event.currentTarget.value);
  pool.setLevel(state.output);
  updateUi();
});

$("resetAnnealogue").addEventListener("click", () => {
  state.landscapeId = ANNEALOGUE_DEFAULTS.landscapeId;
  state.durationSeconds = ANNEALOGUE_DEFAULTS.durationSeconds;
  state.gamma = ANNEALOGUE_DEFAULTS.gamma;
  state.output = DEFAULT_OUTPUT;
  pool.setLevel(state.output);
  restart({ announceChange: false });
  announce("Annealogue parameters reset.");
});

globalThis.addEventListener("keydown", (event) => {
  if (event.key === "Escape") {
    if (state.audioOn || state.audioStarting) {
      audioRequest += 1;
      state.audioOn = false;
      state.audioStarting = false;
      pool.disable();
      updateUi();
      drawLandscape();
      announce("Audio off.");
    }
    return;
  }

  const tagName = event.target?.tagName;
  const isFormControl = tagName === "INPUT" || tagName === "SELECT"
    || tagName === "TEXTAREA" || tagName === "BUTTON";
  if (isFormControl) return;

  if (event.key === " ") {
    event.preventDefault();
    togglePlayback();
  } else if (event.key === "ArrowRight" || event.key === "ArrowLeft") {
    event.preventDefault();
    const direction = event.key === "ArrowRight" ? 1 : -1;
    recomputeAtProgress(state.progress + direction * (event.shiftKey ? 0.05 : 0.01), {
      announceChange: true,
    });
  } else if (event.key.toLowerCase() === "m") {
    event.preventDefault();
    performMeasurement();
  }
});

const resizeObserver = new ResizeObserver(() => requestFrame());
resizeObserver.observe(stageWrap);
reducedMotionQuery?.addEventListener?.("change", (event) => {
  state.reducedMotion = event.matches;
  updateAudioVoices();
  requestFrame();
});

globalThis.addEventListener("pagehide", (event) => {
  pageActive = false;
  audioRequest += 1;
  state.playing = false;
  state.audioOn = false;
  state.audioStarting = false;
  if (frameRequest) cancelAnimationFrame(frameRequest);
  frameRequest = 0;
  resizeObserver.disconnect();
  if (event.persisted) pool.disable();
  else void pool.close();
});

globalThis.addEventListener("pageshow", (event) => {
  if (!event.persisted) return;
  pageActive = true;
  state.audioOn = false;
  state.audioStarting = false;
  lastFrameTime = null;
  resizeObserver.observe(stageWrap);
  updateUi();
  requestFrame();
});

state.amplitudes = simulateAnneal({
  landscape: state.landscapeId,
  gamma: state.gamma,
  durationSeconds: state.durationSeconds,
  progress: 0,
});
pool.setLevel(state.output);
updateAudioVoices();
updateUi();
resizeCanvas();
drawLandscape();

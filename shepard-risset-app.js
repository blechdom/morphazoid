import {
  MORPHISMA_SWEEP_DEFAULTS,
  MORPHISMA_SWEEP_PRESETS,
  SHEPARD_DEFAULTS,
  SHEPARD_MODES,
  SHEPARD_PRESETS,
  ShepardRissetAudio,
  calculateMorphismaSweepVoices,
  sanitizeMorphismaSweepParams,
  sanitizeShepardParams,
} from "./src/shepard-risset.js";

const $ = (id) => document.getElementById(id);
const audio = new ShepardRissetAudio(globalThis);
const reducedMotion = globalThis.matchMedia?.(
  "(prefers-reduced-motion: reduce)",
)?.matches ?? false;
const canvas = $("stage");
const context2d = canvas.getContext("2d", {
  alpha: true,
  desynchronized: true,
});
const waveform = new Float32Array(512);
const DEFAULT_SAMPLE_RATE = 48_000;
const DRAW_INTERVAL = 1_000 / 30;

function directionSign(value, fallback = 1) {
  if (value === false || value === "false") return -1;
  if (value === true || value === "true") return 1;
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  return numeric < 0 ? -1 : 1;
}

function octaveMemory(preset = SHEPARD_PRESETS[0]) {
  const safe = sanitizeShepardParams({
    ...SHEPARD_DEFAULTS,
    ...preset,
  });
  return {
    direction: safe.rate < 0 ? -1 : 1,
    speed: Math.abs(safe.rate),
    centerFrequency: safe.centerFrequency,
    width: safe.width,
    spread: safe.spread,
    cutoff: safe.cutoff,
    presetId: preset?.id ?? null,
  };
}

function morphismaMemory(preset = MORPHISMA_SWEEP_PRESETS[0]) {
  const safe = sanitizeMorphismaSweepParams({
    ...MORPHISMA_SWEEP_DEFAULTS,
    ...preset,
  });
  return {
    direction: directionSign(safe.direction),
    voices: safe.voices,
    sweepRate: safe.sweepRate,
    startFrequency: safe.startFrequency,
    sweepRange: safe.sweepRange,
    cutoff: sanitizeShepardParams({
      cutoff: preset?.cutoff ?? MORPHISMA_SWEEP_DEFAULTS.cutoff ?? 18_000,
    }).cutoff,
    presetId: preset?.id ?? null,
  };
}

const state = {
  mode: SHEPARD_MODES.OCTAVE,
  octave: octaveMemory(),
  morphisma: morphismaMemory(),
  level: SHEPARD_DEFAULTS.level,
  audioOn: false,
  audioStarting: false,
  octaveVisualPhase: 0,
  morphismaVisualPhase: 0,
};

let animationFrame = 0;
let lastAnimationTime = 0;
let lastDrawTime = -Infinity;
let canvasWidth = 1;
let canvasHeight = 1;
let canvasScale = 1;
let disposed = false;
let visualizationDirty = true;

function isMorphisma() {
  return state.mode === SHEPARD_MODES.MORPHISMA;
}

function activeMemory() {
  return isMorphisma() ? state.morphisma : state.octave;
}

function activePresets() {
  return isMorphisma() ? MORPHISMA_SWEEP_PRESETS : SHEPARD_PRESETS;
}

function selectedPreset() {
  const presetId = activeMemory().presetId;
  return activePresets().find(({ id }) => id === presetId) ?? null;
}

function setPressed(element, pressed) {
  element.setAttribute("aria-pressed", String(Boolean(pressed)));
}

function announce(message) {
  $("liveStatus").textContent = message;
}

function showAudioError(error) {
  const message = error instanceof Error ? error.message : String(error);
  $("audioError").textContent = message;
  $("audioError").hidden = false;
}

function clearAudioError() {
  $("audioError").hidden = true;
  $("audioError").textContent = "";
}

function compactNumber(value, digits = 2) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return "0";
  return numeric.toFixed(digits).replace(/\.?0+$/, "");
}

function formatFrequency(value) {
  const frequency = Math.max(0, Number(value) || 0);
  if (frequency >= 1_000) {
    return `${compactNumber(frequency / 1_000, frequency >= 10_000 ? 1 : 2)} kHz`;
  }
  if (frequency >= 100) return `${compactNumber(frequency, 1)} Hz`;
  return `${compactNumber(frequency, 2)} Hz`;
}

function presetDetail(preset) {
  if (preset?.description) return preset.description;
  if (isMorphisma()) {
    return `${preset.voices} voices · ${compactNumber(preset.sweepRate, 2)} cyc/s`;
  }
  const direction = preset.rate < 0 ? "fall" : "rise";
  return `${direction} · ${compactNumber(Math.abs(preset.rate), 2)} oct/s`;
}

function renderPresetGrid() {
  const grid = $("presetGrid");
  grid.replaceChildren();
  grid.classList.toggle("is-dense", isMorphisma());
  grid.setAttribute(
    "aria-label",
    `${isMorphisma() ? "Morphisma Sweep" : "Octave Bank"} presets`,
  );

  const activeId = activeMemory().presetId;
  for (const preset of activePresets()) {
    const button = document.createElement("button");
    const label = document.createElement("b");
    const detail = document.createElement("small");
    button.type = "button";
    button.dataset.mode = state.mode;
    button.dataset.preset = preset.id;
    button.dataset.presetKey = `${state.mode}:${preset.id}`;
    setPressed(button, preset.id === activeId);
    label.textContent = preset.label ?? preset.id;
    detail.textContent = presetDetail(preset);
    button.append(label, detail);
    grid.append(button);
  }
}

function currentParameters() {
  if (isMorphisma()) {
    const memory = state.morphisma;
    const safe = sanitizeMorphismaSweepParams({
      voices: memory.voices,
      sweepRate: memory.sweepRate,
      startFrequency: memory.startFrequency,
      sweepRange: memory.sweepRange,
      direction: memory.direction,
    });
    return {
      mode: SHEPARD_MODES.MORPHISMA,
      voices: safe.voices,
      sweepRate: safe.sweepRate,
      startFrequency: safe.startFrequency,
      sweepRange: safe.sweepRange,
      direction: safe.direction,
      cutoff: memory.cutoff,
      level: state.level,
    };
  }

  const memory = state.octave;
  const safe = sanitizeShepardParams({
    centerFrequency: memory.centerFrequency,
    rate: memory.speed * memory.direction,
    width: memory.width,
    spread: memory.spread,
    cutoff: memory.cutoff,
    level: state.level,
  });
  return {
    mode: SHEPARD_MODES.OCTAVE,
    ...safe,
  };
}

function updateAudioParameters() {
  audio.setParameters(currentParameters());
}

function currentMorphismaFrame() {
  const memory = state.morphisma;
  return calculateMorphismaSweepVoices({
    position: state.morphismaVisualPhase,
    voices: memory.voices,
    sweepRate: memory.sweepRate,
    startFrequency: memory.startFrequency,
    sweepRange: memory.sweepRange,
    direction: memory.direction,
    sampleRate: audio.context?.sampleRate ?? DEFAULT_SAMPLE_RATE,
  });
}

function updateMorphismaVoiceReadouts(frame) {
  const memory = state.morphisma;
  const requested = frame.requestedVoices;
  const audible = frame.audibleVoices;
  const summary = `${requested} requested · ${audible} audible`;
  const readout = [
    "MORPHISMA SWEEP",
    memory.direction > 0 ? "RISING" : "FALLING",
    `${requested} REQUESTED`,
    `${audible} AUDIBLE`,
    `${memory.sweepRate.toFixed(2)} CYCLES/S`,
    state.audioOn ? "AUDIO ON" : "AUDIO OFF",
  ].join(" · ");
  if ($("soundSummary").textContent !== summary) {
    $("soundSummary").textContent = summary;
  }
  if ($("stageReadout").textContent !== readout) {
    $("stageReadout").textContent = readout;
  }
}

function updateInterface({ rebuildPresets = false } = {}) {
  const morphisma = isMorphisma();
  const memory = activeMemory();
  const rising = memory.direction > 0;

  document.body.classList.toggle("is-morphisma", morphisma);
  setPressed($("modeOctave"), !morphisma);
  setPressed($("modeMorphisma"), morphisma);
  setPressed($("directionRise"), rising);
  setPressed($("directionFall"), !rising);
  setPressed($("audioButton"), state.audioOn);
  $("audioButton").disabled = state.audioStarting;
  $("audioState").textContent = state.audioOn ? "on" : "off";
  $("modeSummary").textContent = morphisma ? "Morphisma Sweep" : "Octave Bank";
  $("octaveControls").hidden = morphisma;
  $("morphismaControls").hidden = !morphisma;

  $("speed").value = String(state.octave.speed);
  $("centerFrequency").value = String(state.octave.centerFrequency);
  $("width").value = String(state.octave.width);
  $("spread").value = String(state.octave.spread);
  $("voices").value = String(state.morphisma.voices);
  $("sweepSpeed").value = String(state.morphisma.sweepRate);
  $("startFrequency").value = String(state.morphisma.startFrequency);
  $("sweepRange").value = String(state.morphisma.sweepRange);
  $("cutoff").value = String(memory.cutoff);
  $("level").value = String(state.level);

  $("speedOut").textContent = `${state.octave.speed.toFixed(2)} oct/s`;
  $("centerFrequencyOut").textContent = formatFrequency(state.octave.centerFrequency);
  $("widthOut").textContent = `${state.octave.width.toFixed(1)} oct`;
  $("spreadOut").textContent = `${Math.round(state.octave.spread * 100)}%`;
  $("voicesOut").textContent = String(Math.round(state.morphisma.voices));
  $("sweepSpeedOut").textContent = `${state.morphisma.sweepRate.toFixed(2)} cycles/s`;
  $("startFrequencyOut").textContent = formatFrequency(state.morphisma.startFrequency);
  $("sweepRangeOut").textContent = state.morphisma.sweepRange.toFixed(2);
  $("cutoffOut").textContent = formatFrequency(memory.cutoff);
  $("levelOut").textContent = `${Math.round(state.level * 100)}%`;

  if (morphisma) {
    const frame = currentMorphismaFrame();
    const audible = frame.audibleVoices;
    $("motionSummary").textContent = `${rising ? "rise" : "fall"} · ${Math.round(memory.voices)} voices`;
    $("stageModeCaption").textContent = "original Morphisma quadratic sweep";
    $("directionMarkerText").textContent = rising
      ? "quadratic sweep rising"
      : "quadratic sweep falling";
    $("signalSourceLabel").textContent = "Lanes";
    $("signalSourceDetail").textContent = `${Math.round(memory.voices)} phase staggered`;
    $("signalMotionLabel").textContent = "Sweep";
    $("signalMotionDetail").textContent = `quadratic · range ${memory.sweepRange.toFixed(2)}`;
    updateMorphismaVoiceReadouts(frame);
    canvas.setAttribute(
      "aria-label",
      `Morphisma Sweep mode. ${Math.round(memory.voices)} phase-staggered quadratic lanes move ${rising ? "upward" : "downward"}; ${audible} are currently audible.`,
    );
  } else {
    $("motionSummary").textContent = `${rising ? "rise" : "fall"} · ${memory.speed.toFixed(2)} oct/s`;
    $("soundSummary").textContent = `${memory.width.toFixed(1)} oct · ${Math.round(memory.spread * 100)}% stereo`;
    $("stageModeCaption").textContent = "phase-staggered octave illusion";
    $("directionMarkerText").textContent = rising ? "endlessly rising" : "endlessly falling";
    $("signalSourceLabel").textContent = "Bank";
    $("signalSourceDetail").textContent = "power normalized";
    $("signalMotionLabel").textContent = "Band";
    $("signalMotionDetail").textContent = "28 Hz · tone ceiling";
    $("stageReadout").textContent = [
      "OCTAVE BANK",
      rising ? "RISING" : "FALLING",
      `${memory.speed.toFixed(2)} OCT/S`,
      `${memory.width.toFixed(1)} OCT BANK`,
      state.audioOn ? "AUDIO ON" : "AUDIO OFF",
    ].join(" · ");
    canvas.setAttribute(
      "aria-label",
      `Octave Bank mode. Animated barber-pole stripes and octave traces move ${rising ? "upward" : "downward"}.`,
    );
  }

  $("directionMarker").textContent = rising ? "↑" : "↓";
  const preset = selectedPreset();
  $("presetSummary").textContent = preset?.label ?? "Custom";
  if (rebuildPresets) renderPresetGrid();
  else {
    for (const button of $("presetGrid").querySelectorAll("[data-preset]")) {
      setPressed(
        button,
        button.dataset.mode === state.mode
          && button.dataset.preset === activeMemory().presetId,
      );
    }
  }

  updateAudioParameters();
  visualizationDirty = true;
  scheduleAnimation();
}

function markCustom() {
  activeMemory().presetId = null;
}

function applyPreset(id) {
  const preset = activePresets().find((candidate) => candidate.id === id);
  if (!preset) return;
  if (isMorphisma()) {
    const currentCutoff = state.morphisma.cutoff;
    state.morphisma = {
      ...morphismaMemory(preset),
      cutoff: currentCutoff,
    };
  } else {
    state.octave = octaveMemory(preset);
  }
  updateInterface({ rebuildPresets: true });
  announce(`${preset.label ?? preset.id} ${isMorphisma() ? "Morphisma Sweep" : "Octave Bank"} preset loaded.`);
}

function selectMode(mode) {
  const nextMode = mode === SHEPARD_MODES.MORPHISMA
    ? SHEPARD_MODES.MORPHISMA
    : SHEPARD_MODES.OCTAVE;
  if (nextMode === state.mode) return;
  state.mode = nextMode;
  clearAudioError();
  updateInterface({ rebuildPresets: true });
  announce(`${isMorphisma() ? "Morphisma Sweep" : "Octave Bank"} mode selected.`);
}

$("modeSelector").addEventListener("click", (event) => {
  const button = event.target.closest("[data-mode]");
  if (button) selectMode(button.dataset.mode);
});

$("presetGrid").addEventListener("click", (event) => {
  const button = event.target.closest("[data-preset]");
  if (button?.dataset.mode === state.mode) applyPreset(button.dataset.preset);
});

$("direction").addEventListener("click", (event) => {
  const button = event.target.closest("[data-value]");
  if (!button) return;
  activeMemory().direction = Number(button.dataset.value) < 0 ? -1 : 1;
  markCustom();
  updateInterface();
  announce(`${isMorphisma() ? "Sweep" : "Glissando"} now ${activeMemory().direction > 0 ? "rises" : "falls"}.`);
});

function bindRange(id, onInput) {
  $(id).addEventListener("input", (event) => {
    onInput(Number(event.currentTarget.value));
    updateInterface();
  });
}

bindRange("speed", (value) => {
  state.octave.speed = value;
  state.octave.presetId = null;
});
bindRange("centerFrequency", (value) => {
  state.octave.centerFrequency = value;
  state.octave.presetId = null;
});
bindRange("width", (value) => {
  state.octave.width = value;
  state.octave.presetId = null;
});
bindRange("spread", (value) => {
  state.octave.spread = value;
  state.octave.presetId = null;
});
bindRange("voices", (value) => {
  state.morphisma.voices = value;
  state.morphisma.presetId = null;
});
bindRange("sweepSpeed", (value) => {
  state.morphisma.sweepRate = value;
  state.morphisma.presetId = null;
});
bindRange("startFrequency", (value) => {
  state.morphisma.startFrequency = value;
  state.morphisma.presetId = null;
});
bindRange("sweepRange", (value) => {
  state.morphisma.sweepRange = value;
  state.morphisma.presetId = null;
});
bindRange("cutoff", (value) => {
  activeMemory().cutoff = value;
  if (!isMorphisma()) state.octave.presetId = null;
});
bindRange("level", (value) => {
  state.level = value;
});

async function toggleAudio() {
  if (state.audioStarting) return;
  state.audioStarting = true;
  clearAudioError();
  updateInterface();
  try {
    if (state.audioOn) {
      audio.stop();
      state.audioOn = false;
    } else {
      updateAudioParameters();
      await audio.start();
      state.audioOn = true;
    }
    announce(`Audio ${state.audioOn ? "on" : "off"}.`);
  } catch (error) {
    state.audioOn = false;
    showAudioError(error);
    announce("Audio could not start.");
  } finally {
    state.audioStarting = false;
    updateInterface();
  }
}

$("audioButton").addEventListener("click", toggleAudio);

$("[data-reset-all]").addEventListener("click", () => {
  state.octave = octaveMemory(SHEPARD_PRESETS[0]);
  state.morphisma = morphismaMemory(MORPHISMA_SWEEP_PRESETS[0]);
  state.level = SHEPARD_DEFAULTS.level;
  state.octaveVisualPhase = 0;
  state.morphismaVisualPhase = 0;
  clearAudioError();
  updateInterface({ rebuildPresets: true });
  announce(`Both mode memories reset. ${isMorphisma() ? "Morphisma Sweep" : "Octave Bank"} remains selected.`);
});

canvas.addEventListener("keydown", (event) => {
  if (event.key === "ArrowUp" || event.key === "ArrowDown") {
    event.preventDefault();
    activeMemory().direction = event.key === "ArrowUp" ? 1 : -1;
    markCustom();
    updateInterface();
    announce(`${isMorphisma() ? "Sweep" : "Glissando"} now ${activeMemory().direction > 0 ? "rises" : "falls"}.`);
  } else if (event.key === " ") {
    event.preventDefault();
    toggleAudio();
  }
});

function resizeCanvas() {
  if (disposed) return;
  const rect = canvas.getBoundingClientRect();
  const dpr = Math.min(1.5, Math.max(1, globalThis.devicePixelRatio || 1));
  const nextWidth = Math.max(1, Math.round(rect.width * dpr));
  const nextHeight = Math.max(1, Math.round(rect.height * dpr));
  if (canvas.width !== nextWidth || canvas.height !== nextHeight) {
    canvas.width = nextWidth;
    canvas.height = nextHeight;
  }
  canvasWidth = Math.max(1, rect.width);
  canvasHeight = Math.max(1, rect.height);
  canvasScale = dpr;
  context2d.setTransform(dpr, 0, 0, dpr, 0, 0);
  visualizationDirty = true;
  scheduleAnimation();
}

function roundedRectPath(ctx, x, y, width, height, radius) {
  const r = Math.min(radius, width * 0.5, height * 0.5);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + width, y, x + width, y + height, r);
  ctx.arcTo(x + width, y + height, x, y + height, r);
  ctx.arcTo(x, y + height, x, y, r);
  ctx.arcTo(x, y, x + width, y, r);
  ctx.closePath();
}

function drawBarberPole(ctx, width, height) {
  const memory = state.octave;
  const poleWidth = Math.min(360, Math.max(150, width * 0.34));
  const poleHeight = Math.min(height * 0.72, 620);
  const x = (width - poleWidth) * 0.5;
  const y = (height - poleHeight) * 0.5;
  const radius = Math.min(82, poleWidth * 0.28);
  const stripeWidth = Math.max(24, poleWidth / 7);
  const diagonalLength = poleWidth + poleHeight;
  const travel = (state.octaveVisualPhase * stripeWidth * 3) % (stripeWidth * 3);

  ctx.save();
  roundedRectPath(ctx, x, y, poleWidth, poleHeight, radius);
  ctx.clip();

  const poleGradient = ctx.createLinearGradient(x, 0, x + poleWidth, 0);
  poleGradient.addColorStop(0, "rgba(0, 0, 0, 0.82)");
  poleGradient.addColorStop(0.18, "rgba(20, 24, 30, 0.82)");
  poleGradient.addColorStop(0.5, "rgba(46, 31, 40, 0.7)");
  poleGradient.addColorStop(0.82, "rgba(20, 24, 30, 0.82)");
  poleGradient.addColorStop(1, "rgba(0, 0, 0, 0.86)");
  ctx.fillStyle = poleGradient;
  ctx.fillRect(x, y, poleWidth, poleHeight);

  ctx.translate(width * 0.5, height * 0.5);
  ctx.rotate(memory.direction > 0 ? -Math.PI / 4 : Math.PI / 4);
  const colors = [
    "rgba(255, 120, 152, 0.62)",
    "rgba(242, 232, 218, 0.48)",
    "rgba(125, 180, 255, 0.52)",
  ];
  for (
    let stripe = -diagonalLength * 1.5;
    stripe < diagonalLength * 1.5;
    stripe += stripeWidth
  ) {
    const colorIndex = (
      Math.floor((stripe + diagonalLength * 1.5) / stripeWidth) % colors.length
    );
    ctx.fillStyle = colors[colorIndex];
    ctx.fillRect(
      stripe + travel * memory.direction,
      -diagonalLength,
      stripeWidth * 0.58,
      diagonalLength * 2,
    );
  }
  ctx.restore();

  ctx.save();
  roundedRectPath(ctx, x, y, poleWidth, poleHeight, radius);
  ctx.lineWidth = 1;
  ctx.strokeStyle = "rgba(255, 243, 214, 0.28)";
  ctx.stroke();
  const rings = Math.max(1, Math.round(memory.width));
  for (let ring = 1; ring < rings; ring += 1) {
    const ringY = y + poleHeight * ring / rings;
    ctx.beginPath();
    ctx.moveTo(x + 10, ringY);
    ctx.lineTo(x + poleWidth - 10, ringY);
    ctx.strokeStyle = "rgba(255, 243, 214, 0.09)";
    ctx.stroke();
  }
  ctx.restore();
}

function logFrequencyY(frequency, top, bottom) {
  const minimum = 20;
  const maximum = Math.max(minimum * 2, activeMemory().cutoff);
  const normalized = (
    Math.log(Math.max(minimum, Math.min(maximum, frequency)) / minimum)
    / Math.log(maximum / minimum)
  );
  return bottom - normalized * (bottom - top);
}

function drawMorphismaSweep(ctx, width, height) {
  const memory = state.morphisma;
  const frame = currentMorphismaFrame();
  updateMorphismaVoiceReadouts(frame);
  const voices = frame.requestedVoices;
  const left = Math.max(26, width * 0.07);
  const right = width - left;
  const top = Math.max(54, height * 0.12);
  const bottom = Math.min(height - 78, height * 0.82);

  ctx.save();
  ctx.lineWidth = 1;
  for (let row = 0; row <= 4; row += 1) {
    const y = top + (bottom - top) * row / 4;
    ctx.beginPath();
    ctx.moveTo(left, y);
    ctx.lineTo(right, y);
    ctx.strokeStyle = "rgba(214, 232, 226, 0.07)";
    ctx.stroke();
  }

  const totalSpan = memory.startFrequency * memory.sweepRange * voices;
  ctx.beginPath();
  for (let segment = 0; segment <= 64; segment += 1) {
    const phase = segment / 64;
    const directedPhase = memory.direction > 0 ? phase : 1 - phase;
    const frequency = (
      memory.startFrequency + directedPhase * directedPhase * totalSpan
    );
    const x = left + phase * (right - left);
    const y = logFrequencyY(frequency, top, bottom);
    if (segment === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.strokeStyle = "rgba(125, 180, 255, 0.18)";
  ctx.stroke();

  for (const voice of frame.voices) {
    const alpha = 0.08 + voice.envelope * (voice.active ? 0.5 : 0.12);
    const x = left + voice.phase * (right - left);
    const y = logFrequencyY(voice.frequency, top, bottom);
    const laneLength = Math.max(8, (right - left) / Math.max(12, voices));
    ctx.beginPath();
    ctx.moveTo(Math.max(left, x - laneLength), y);
    ctx.lineTo(Math.min(right, x + laneLength), y);
    ctx.strokeStyle = voice.active
      ? `rgba(125, 180, 255, ${alpha})`
      : `rgba(119, 131, 126, ${alpha})`;
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(x, y, voice.active ? 2.2 : 1.4, 0, Math.PI * 2);
    ctx.fillStyle = voice.active
      ? `rgba(255, 120, 152, ${0.35 + voice.envelope * 0.65})`
      : "rgba(119, 131, 126, 0.25)";
    ctx.fill();
  }

  ctx.fillStyle = "rgba(214, 232, 226, 0.5)";
  ctx.font = "8px ui-monospace, SFMono-Regular, Menlo, monospace";
  ctx.textAlign = "right";
  ctx.fillText(
    `REQUESTED ${voices} · AUDIBLE ${frame.audibleVoices}`,
    right,
    top - 16,
  );
  ctx.restore();
}

function drawWaveform(ctx, width, height) {
  if (!state.audioOn || !audio.getWaveform(waveform)) return;
  const yCenter = height * 0.5;
  const amplitude = Math.min(74, height * 0.12);
  ctx.save();
  ctx.beginPath();
  for (let index = 0; index < waveform.length; index += 1) {
    const x = index / (waveform.length - 1) * width;
    const y = yCenter + waveform[index] * amplitude;
    if (index === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.strokeStyle = "rgba(255, 243, 214, 0.23)";
  ctx.lineWidth = 1;
  ctx.stroke();
  ctx.restore();
}

function draw(timestamp, force = false) {
  if (!context2d || document.hidden || disposed) return;
  if (!force && !visualizationDirty && timestamp - lastDrawTime < DRAW_INTERVAL) return;
  if (!force && timestamp - lastDrawTime < DRAW_INTERVAL) return;
  lastDrawTime = timestamp;
  visualizationDirty = false;
  context2d.setTransform(canvasScale, 0, 0, canvasScale, 0, 0);
  context2d.clearRect(0, 0, canvasWidth, canvasHeight);
  if (isMorphisma()) drawMorphismaSweep(context2d, canvasWidth, canvasHeight);
  else drawBarberPole(context2d, canvasWidth, canvasHeight);
  drawWaveform(context2d, canvasWidth, canvasHeight);
}

function animate(timestamp) {
  animationFrame = 0;
  if (disposed || document.hidden) return;
  const elapsed = lastAnimationTime > 0
    ? Math.min(0.1, (timestamp - lastAnimationTime) / 1_000)
    : 0;
  lastAnimationTime = timestamp;
  if (state.audioOn && !reducedMotion) {
    if (isMorphisma()) {
      state.morphismaVisualPhase = (
        state.morphismaVisualPhase + elapsed * state.morphisma.sweepRate
      ) % 1;
    } else {
      state.octaveVisualPhase = (
        state.octaveVisualPhase + elapsed * state.octave.speed
      ) % 1;
    }
    visualizationDirty = true;
  }
  draw(timestamp);
  if (state.audioOn) animationFrame = requestAnimationFrame(animate);
}

function scheduleAnimation() {
  if (disposed || document.hidden || animationFrame) return;
  animationFrame = requestAnimationFrame(animate);
}

const resizeObserver = typeof ResizeObserver === "function"
  ? new ResizeObserver(resizeCanvas)
  : null;

function handleVisibilityChange() {
  if (document.hidden) {
    if (animationFrame) cancelAnimationFrame(animationFrame);
    animationFrame = 0;
    return;
  }
  lastAnimationTime = performance.now();
  visualizationDirty = true;
  resizeCanvas();
}

function handlePageHide() {
  disposed = true;
  if (animationFrame) cancelAnimationFrame(animationFrame);
  animationFrame = 0;
  resizeObserver?.disconnect();
  globalThis.removeEventListener("resize", resizeCanvas);
  document.removeEventListener("visibilitychange", handleVisibilityChange);
  audio.close();
}

resizeObserver?.observe(canvas);
globalThis.addEventListener("resize", resizeCanvas);
document.addEventListener("visibilitychange", handleVisibilityChange);
globalThis.addEventListener("pagehide", handlePageHide, { once: true });

renderPresetGrid();
updateInterface();
resizeCanvas();

import {
  LINEAR_DRUM_MODELS,
  LINEAR_DRUM_PRESETS,
  LinearDrumAudio,
  linearDrumFrequencyAtPosition,
  linearDrumPositionAtFrequency,
} from "./src/linear-drums.js";
import {
  PAINT_MACHINE_LAYER_DEFAULTS,
  PAINT_MACHINE_TARGETS,
  createPaintMachineDemo,
  paintMachineApplyModulators,
  paintMachineDistanceToItem,
  paintMachineFrequency,
  paintMachineIntersections,
  paintMachineLoopDurationMs,
  paintMachineLoopPhase,
  paintMachinePhaseCrossed,
  sanitizePaintItem,
  simplifyPaintPoints,
} from "./src/linear-drums-machine.js";

const $ = (id) => document.getElementById(id);
const clamp = (value, minimum, maximum) => Math.min(maximum, Math.max(minimum, value));
const canvas = $("paintStage");
const stageWrap = $("paintStageWrap");
const context = canvas.getContext("2d", { alpha: false, desynchronized: true });
const audio = new LinearDrumAudio(globalThis);
const presetById = new Map(LINEAR_DRUM_PRESETS.map((preset) => [preset.id, preset]));
const modelById = new Map(LINEAR_DRUM_MODELS.map((model) => [model.id, model]));
const STORAGE_KEY = "morphazoid:linear-drums-machine:v1";

const cloneLayers = () => PAINT_MACHINE_LAYER_DEFAULTS.map((layer) => ({ ...layer }));
const cloneItems = (items) => items.map((item) => ({
  ...item,
  points: item.points?.map((point) => ({ ...point })),
}));

const state = {
  items: createPaintMachineDemo(),
  layers: cloneLayers(),
  selectedLayer: 0,
  tool: "hit",
  tempo: 112,
  beats: 8,
  glissRate: 18,
  brushSize: .014,
  rangeMin: 20,
  rangeMax: 16_000,
  output: .58,
  phase: 0,
  playing: false,
  startedAt: 0,
  previousPhase: 0,
  lastGlissAt: 0,
  audioOn: false,
  history: [],
  draft: null,
  pointerActive: false,
  pointerPoint: null,
};

let cssWidth = 1;
let cssHeight = 1;
let pixelRatio = 1;
let scheduledFrame = 0;
let playbackTimer = 0;
let audioLifecycleGeneration = 0;
let audioStartPromise = null;
let itemSequence = Date.now();
let lastPaintPoint = null;
let pulses = [];

function formatFrequency(frequency) {
  if (frequency >= 10_000) return `${(frequency / 1_000).toFixed(frequency % 1_000 ? 1 : 0)} kHz`;
  if (frequency >= 1_000) return `${(frequency / 1_000).toFixed(frequency % 1_000 ? 2 : 0)} kHz`;
  if (frequency >= 100) return `${Math.round(frequency)} Hz`;
  return `${frequency.toFixed(frequency < 30 ? 1 : 0)} Hz`;
}

function formatSignedPercent(value) {
  const amount = Math.round(value * 100);
  return `${amount > 0 ? "+" : ""}${amount}%`;
}

function announce(message) {
  $("paintLiveStatus").textContent = "";
  requestAnimationFrame(() => { $("paintLiveStatus").textContent = message; });
}

function showError(error) {
  $("audioError").textContent = error instanceof Error ? error.message : String(error);
  $("audioError").hidden = false;
}

function layerAt(index) {
  return state.layers[clamp(Math.round(index), 0, state.layers.length - 1)];
}

function selectedLayer() {
  return layerAt(state.selectedLayer);
}

function nextItemId(prefix) {
  itemSequence += 1;
  return `${prefix}-${itemSequence}`;
}

function saveState() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({
      items: state.items,
      layers: state.layers,
      tempo: state.tempo,
      beats: state.beats,
      glissRate: state.glissRate,
      brushSize: state.brushSize,
      rangeMax: state.rangeMax,
    }));
  } catch {
    // Storage is optional; the instrument remains fully usable without it.
  }
}

function restoreState() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "null");
    if (!saved || typeof saved !== "object") return;
    if (Array.isArray(saved.items)) {
      state.items = saved.items.slice(0, 600).map((item, index) => (
        sanitizePaintItem(item, `saved-${index}`)
      ));
    }
    if (Array.isArray(saved.layers)) {
      state.layers = PAINT_MACHINE_LAYER_DEFAULTS.map((fallback, index) => {
        const candidate = saved.layers[index] ?? {};
        return {
          ...fallback,
          role: candidate.role === "mod" ? "mod" : "voice",
          presetId: presetById.has(candidate.presetId) ? candidate.presetId : fallback.presetId,
          target: PAINT_MACHINE_TARGETS.includes(candidate.target) ? candidate.target : fallback.target,
          amount: clamp(Number(candidate.amount) || 0, -1, 1),
        };
      });
    }
    state.tempo = clamp(Number(saved.tempo) || state.tempo, 50, 180);
    state.beats = [4, 8, 16].includes(Number(saved.beats)) ? Number(saved.beats) : state.beats;
    state.glissRate = clamp(Number(saved.glissRate) || state.glissRate, 6, 30);
    state.brushSize = clamp(Number(saved.brushSize) || state.brushSize, .006, .045);
    state.rangeMax = clamp(Number(saved.rangeMax) || state.rangeMax, 4_000, 20_000);
  } catch {
    // Ignore corrupt or unavailable local state.
  }
}

function pushHistory() {
  state.history.push(cloneItems(state.items));
  if (state.history.length > 40) state.history.shift();
  $("undoButton").disabled = state.history.length === 0;
}

function updateEventCount() {
  $("eventCount").textContent = String(state.items.length);
}

function setAudioState(enabled) {
  state.audioOn = enabled;
  $("audioButton").setAttribute("aria-pressed", String(enabled));
  $("audioState").textContent = enabled ? "on" : "off";
  audio.setOutput(enabled ? state.output : 0);
}

function enableAudio() {
  if (state.audioOn && audio.context) return Promise.resolve(true);
  if (audioStartPromise) return audioStartPromise;
  const generation = audioLifecycleGeneration;
  $("audioError").hidden = true;
  let pending;
  pending = audio.start().then((audioContext) => {
    if (generation !== audioLifecycleGeneration || audioContext !== audio.context) return false;
    setAudioState(true);
    if (state.playing) {
      const now = performance.now();
      const phase = paintMachineLoopPhase(now, state.startedAt, state.tempo, state.beats);
      state.phase = phase;
      state.previousPhase = phase;
      state.lastGlissAt = now;
      paintTransport();
    }
    return true;
  }).catch((error) => {
    if (generation !== audioLifecycleGeneration || error?.name === "AbortError") return false;
    showError(error);
    return false;
  }).finally(() => {
    if (audioStartPromise === pending) audioStartPromise = null;
  });
  audioStartPromise = pending;
  return pending;
}

function modulatorsAtPhase(phase) {
  const modulators = [];
  for (const item of state.items) {
    const layer = layerAt(item.layer);
    if (layer.role !== "mod") continue;
    for (const value of paintMachineIntersections(item, phase)) {
      modulators.push({ target: layer.target, amount: layer.amount, value });
    }
  }
  return modulators;
}

function settingsForLayer(layer, phase) {
  const preset = presetById.get(layer.presetId) ?? LINEAR_DRUM_PRESETS[0];
  return paintMachineApplyModulators({
    ...preset.settings,
    rangeMin: state.rangeMin,
    rangeMax: state.rangeMax,
  }, modulatorsAtPhase(phase));
}

async function triggerPaintedVoice(item, vertical, phase, velocity) {
  if (!state.audioOn || !audio.context) return;
  const generation = audioLifecycleGeneration;
  const layer = layerAt(item.layer);
  if (layer.role !== "voice") return;
  try {
    const frequency = paintMachineFrequency(vertical, state.rangeMin, state.rangeMax);
    const parameters = await audio.trigger(frequency, settingsForLayer(layer, phase), {
      velocity,
      performanceY: vertical,
    });
    if (generation !== audioLifecycleGeneration) return;
    pulses.push({
      phase,
      vertical,
      color: layer.color,
      startedAt: performance.now(),
      velocity,
      frequency: parameters.frequency,
    });
    if (pulses.length > 60) pulses = pulses.slice(-60);
    scheduleFrame();
  } catch (error) {
    if (generation === audioLifecycleGeneration && error?.name !== "AbortError") showError(error);
  }
}

function processPlayback(previousPhase, phase, now) {
  for (const item of state.items) {
    const layer = layerAt(item.layer);
    if (layer.role !== "voice" || item.type !== "hit") continue;
    if (paintMachinePhaseCrossed(previousPhase, phase, item.x)) {
      void triggerPaintedVoice(item, item.y, item.x, .72 + item.radius * 5);
    }
  }

  if (now - state.lastGlissAt < 1_000 / state.glissRate) return;
  state.lastGlissAt = now;
  let voiceCount = 0;
  for (const item of state.items) {
    const layer = layerAt(item.layer);
    if (layer.role !== "voice" || item.type === "hit") continue;
    for (const vertical of paintMachineIntersections(item, phase)) {
      void triggerPaintedVoice(item, vertical, phase, item.type === "ring" ? .5 : .58);
      voiceCount += 1;
      if (voiceCount >= 10) return;
    }
  }
}

function playbackTick() {
  if (!state.playing) return;
  const now = performance.now();
  const phase = paintMachineLoopPhase(now, state.startedAt, state.tempo, state.beats);
  processPlayback(state.previousPhase, phase, now);
  state.previousPhase = phase;
  state.phase = phase;
  paintTransport();
  scheduleFrame();
  playbackTimer = window.setTimeout(playbackTick, 16);
}

function paintTransport() {
  $("playButton").setAttribute("aria-pressed", String(state.playing));
  $("playIcon").textContent = state.playing ? "\u25a0" : "\u25b6";
  $("playLabel").textContent = state.playing ? "Pause" : "Play";
  const beat = state.phase * state.beats;
  $("phaseReadout").textContent = `${Math.min(state.beats, Math.floor(beat) + 1)}.${Math.floor((beat % 1) * 4) + 1}`;
}

function startPlayback() {
  if (state.playing) return;
  state.startedAt = performance.now() - state.phase * paintMachineLoopDurationMs(state.tempo, state.beats);
  state.previousPhase = state.phase;
  state.lastGlissAt = 0;
  state.playing = true;
  paintTransport();
  playbackTick();
  announce(state.audioOn
    ? "Painted drum loop playing."
    : "Painted drum loop playing silently. Turn Audio on to hear it.");
}

function pausePlayback() {
  if (playbackTimer) window.clearTimeout(playbackTimer);
  playbackTimer = 0;
  state.playing = false;
  paintTransport();
  scheduleFrame();
}

function stopPlayback() {
  pausePlayback();
  state.phase = 0;
  state.previousPhase = 0;
  paintTransport();
  scheduleFrame();
}

function preservePlaybackPhase(update) {
  const wasPlaying = state.playing;
  if (wasPlaying) {
    state.phase = paintMachineLoopPhase(performance.now(), state.startedAt, state.tempo, state.beats);
  }
  update();
  if (wasPlaying) {
    state.startedAt = performance.now() - state.phase * paintMachineLoopDurationMs(state.tempo, state.beats);
    state.previousPhase = state.phase;
  }
}

function renderPresetOptions() {
  const fragment = document.createDocumentFragment();
  for (const preset of LINEAR_DRUM_PRESETS) {
    const option = document.createElement("option");
    option.value = preset.id;
    option.textContent = preset.name;
    fragment.append(option);
  }
  $("layerPreset").replaceChildren(fragment);
}

function renderPalette() {
  const fragment = document.createDocumentFragment();
  state.layers.forEach((layer, index) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "paint-layer-swatch";
    button.classList.toggle("is-active", index === state.selectedLayer);
    button.classList.toggle("is-mod", layer.role === "mod");
    button.style.setProperty("--layer-color", layer.color);
    button.dataset.paintLayer = String(index);
    button.setAttribute("aria-label", `${layer.name} ${layer.role} layer`);
    button.setAttribute("aria-pressed", String(index === state.selectedLayer));
    button.title = `${layer.name}: ${layer.role}`;
    button.addEventListener("click", () => {
      state.selectedLayer = index;
      renderPalette();
      paintInspector();
      scheduleFrame();
    });
    fragment.append(button);
  });
  $("paintPalette").replaceChildren(fragment);
}

function paintInspector() {
  const layer = selectedLayer();
  $("layerName").textContent = layer.name.toUpperCase();
  $("layerName").style.color = layer.color;
  $("layerRoleVoice").checked = layer.role === "voice";
  $("layerRoleMod").checked = layer.role === "mod";
  $("voiceSettings").hidden = layer.role !== "voice";
  $("modSettings").hidden = layer.role !== "mod";
  $("layerPreset").value = layer.presetId;
  $("modTarget").value = layer.target;
  $("modAmount").value = String(layer.amount);
  $("modAmountOut").textContent = formatSignedPercent(layer.amount);
  const preset = presetById.get(layer.presetId) ?? LINEAR_DRUM_PRESETS[0];
  $("voiceModel").textContent = (modelById.get(preset.settings.model)?.label ?? preset.settings.model).toUpperCase();
  $("selectedLayerReadout").textContent = `${layer.name.toUpperCase()} / ${layer.role.toUpperCase()}`;
}

function renderFrequencyAxis() {
  const values = [20, 50, 100, 250, 500, 1_000, 2_000, 4_000, 8_000, 16_000, 20_000];
  const fragment = document.createDocumentFragment();
  for (const frequency of values) {
    if (frequency < state.rangeMin || frequency > state.rangeMax * 1.001) continue;
    const label = document.createElement("span");
    label.style.setProperty(
      "--axis-position",
      linearDrumPositionAtFrequency(frequency, state.rangeMin, state.rangeMax),
    );
    label.textContent = frequency >= 1_000 ? `${frequency / 1_000}k` : String(frequency);
    fragment.append(label);
  }
  $("frequencyAxis").replaceChildren(fragment);
}

function renderTimeAxis() {
  const fragment = document.createDocumentFragment();
  const step = state.beats > 8 ? 2 : 1;
  for (let beat = 0; beat < state.beats; beat += step) {
    const label = document.createElement("span");
    label.style.setProperty("--axis-position", beat / state.beats);
    label.textContent = String(beat + 1);
    fragment.append(label);
  }
  $("timeAxis").replaceChildren(fragment);
}

function updateControlReadouts() {
  $("tempo").value = String(state.tempo);
  $("tempoOut").textContent = `${state.tempo} BPM`;
  $("glissRate").value = String(state.glissRate);
  $("glissRateOut").textContent = `${state.glissRate} /s`;
  $("glissReadout").textContent = String(state.glissRate);
  $("brushSize").value = String(state.brushSize);
  $("brushSizeOut").textContent = String(Math.round(state.brushSize * 1_000));
  $("rangeCeiling").value = String(
    linearDrumPositionAtFrequency(state.rangeMax, 4_000, 20_000),
  );
  $("rangeCeilingOut").textContent = formatFrequency(state.rangeMax);
  $("frequencyRangeOut").textContent = `${formatFrequency(state.rangeMin)} - ${formatFrequency(state.rangeMax)}`.toUpperCase();
  const beatInput = document.querySelector(`input[name="loopBeats"][value="${state.beats}"]`);
  if (beatInput) beatInput.checked = true;
  updateEventCount();
}

function setTool(tool) {
  state.tool = tool;
  for (const button of document.querySelectorAll("[data-paint-tool]")) {
    const active = button.dataset.paintTool === tool;
    button.classList.toggle("is-active", active);
    button.setAttribute("aria-pressed", String(active));
  }
  canvas.style.cursor = tool === "erase" ? "cell" : "crosshair";
}

function canvasPoint(event) {
  const bounds = canvas.getBoundingClientRect();
  return {
    x: clamp((event.clientX - bounds.left) / Math.max(1, bounds.width), 0, 1),
    y: 1 - clamp((event.clientY - bounds.top) / Math.max(1, bounds.height), 0, 1),
  };
}

function updateCursor(point) {
  state.pointerPoint = point;
  const frequency = paintMachineFrequency(point.y, state.rangeMin, state.rangeMax);
  const beat = point.x * state.beats;
  $("paintCursor").textContent = `${formatFrequency(frequency)} / ${Math.floor(beat) + 1}.${Math.floor((beat % 1) * 4) + 1}`;
  $("paintCursor").style.setProperty("--cursor-x", `${point.x * 100}%`);
  $("paintCursor").style.setProperty("--cursor-y", `${(1 - point.y) * 100}%`);
  $("paintCursor").style.setProperty("--cursor-color", selectedLayer().color);
  $("paintCursor").hidden = false;
}

function addHit(point) {
  state.items.push(sanitizePaintItem({
    id: nextItemId("hit"),
    type: "hit",
    layer: state.selectedLayer,
    x: point.x,
    y: point.y,
    radius: state.brushSize,
  }));
  lastPaintPoint = point;
  updateEventCount();
}

function eraseAt(point) {
  const aspect = cssWidth / Math.max(1, cssHeight);
  const threshold = state.brushSize * 1.45;
  const next = state.items.filter((item) => (
    paintMachineDistanceToItem(item, point, aspect) > threshold
  ));
  if (next.length !== state.items.length) {
    state.items = next;
    updateEventCount();
  }
}

canvas.addEventListener("pointerdown", (event) => {
  event.preventDefault();
  state.pointerActive = true;
  canvas.setPointerCapture?.(event.pointerId);
  const point = canvasPoint(event);
  updateCursor(point);
  pushHistory();
  if (state.tool === "hit") {
    addHit(point);
  } else if (state.tool === "erase") {
    eraseAt(point);
  } else if (state.tool === "stroke") {
    state.draft = {
      id: nextItemId("stroke"), type: "stroke", layer: state.selectedLayer,
      points: [point, point],
    };
  } else {
    state.draft = {
      id: nextItemId("ring"), type: "ring", layer: state.selectedLayer,
      x: point.x, y: point.y, radiusX: .006, radiusY: .006,
    };
  }
  scheduleFrame();
});

canvas.addEventListener("pointermove", (event) => {
  const point = canvasPoint(event);
  updateCursor(point);
  if (!state.pointerActive) return;
  event.preventDefault();
  if (state.tool === "hit") {
    if (!lastPaintPoint || Math.hypot(point.x - lastPaintPoint.x, point.y - lastPaintPoint.y) > state.brushSize * 2.2) {
      addHit(point);
    }
  } else if (state.tool === "erase") {
    eraseAt(point);
  } else if (state.tool === "stroke" && state.draft) {
    const previous = state.draft.points[state.draft.points.length - 1];
    if (Math.hypot(point.x - previous.x, point.y - previous.y) > .002) {
      state.draft.points.push(point);
    } else {
      state.draft.points[state.draft.points.length - 1] = point;
    }
  } else if (state.tool === "ring" && state.draft) {
    state.draft.radiusX = Math.max(.006, Math.abs(point.x - state.draft.x));
    state.draft.radiusY = Math.max(.006, Math.abs(point.y - state.draft.y));
  }
  scheduleFrame();
});

const releasePointer = (event) => {
  if (!state.pointerActive) return;
  state.pointerActive = false;
  try { canvas.releasePointerCapture?.(event.pointerId); } catch { /* already released */ }
  if (state.draft) {
    if (state.draft.type === "stroke") {
      state.draft.points = simplifyPaintPoints(state.draft.points, .004);
    }
    state.items.push(sanitizePaintItem(state.draft, state.draft.id));
    state.draft = null;
  }
  lastPaintPoint = null;
  updateEventCount();
  saveState();
  scheduleFrame();
};
canvas.addEventListener("pointerup", releasePointer);
canvas.addEventListener("pointercancel", releasePointer);
canvas.addEventListener("pointerleave", () => {
  if (!state.pointerActive) $("paintCursor").hidden = true;
});

function bindControls() {
  for (const button of document.querySelectorAll("[data-paint-tool]")) {
    button.addEventListener("click", () => setTool(button.dataset.paintTool));
  }

  $("playButton").addEventListener("click", () => {
    if (state.playing) pausePlayback();
    else startPlayback();
  });
  $("stopButton").addEventListener("click", stopPlayback);
  $("audioButton").addEventListener("click", async () => {
    const button = $("audioButton");
    button.disabled = true;
    try {
      if (state.audioOn) {
        audioLifecycleGeneration += 1;
        audioStartPromise = null;
        setAudioState(false);
        await audio.close().catch(() => {});
        announce("Painted drum audio off.");
      } else if (await enableAudio()) {
        announce("Painted drum audio on.");
      }
    } finally {
      button.disabled = false;
    }
  });
  $("output").addEventListener("input", () => {
    state.output = Number($("output").value);
    $("outputOut").textContent = `${Math.round(state.output * 100)}%`;
    audio.setOutput(state.audioOn ? state.output : 0);
  });
  $("tempo").addEventListener("input", () => {
    preservePlaybackPhase(() => { state.tempo = Number($("tempo").value); });
    $("tempoOut").textContent = `${state.tempo} BPM`;
    saveState();
  });
  for (const input of document.querySelectorAll('input[name="loopBeats"]')) {
    input.addEventListener("change", () => {
      if (!input.checked) return;
      preservePlaybackPhase(() => { state.beats = Number(input.value); });
      renderTimeAxis();
      saveState();
      scheduleFrame();
    });
  }
  $("glissRate").addEventListener("input", () => {
    state.glissRate = Number($("glissRate").value);
    $("glissRateOut").textContent = `${state.glissRate} /s`;
    $("glissReadout").textContent = String(state.glissRate);
    saveState();
  });
  $("brushSize").addEventListener("input", () => {
    state.brushSize = Number($("brushSize").value);
    $("brushSizeOut").textContent = String(Math.round(state.brushSize * 1_000));
    saveState();
  });
  $("rangeCeiling").addEventListener("input", () => {
    state.rangeMax = linearDrumFrequencyAtPosition(Number($("rangeCeiling").value), 4_000, 20_000);
    $("rangeCeilingOut").textContent = formatFrequency(state.rangeMax);
    $("frequencyRangeOut").textContent = `${formatFrequency(state.rangeMin)} - ${formatFrequency(state.rangeMax)}`.toUpperCase();
    renderFrequencyAxis();
    saveState();
    scheduleFrame();
  });

  for (const input of document.querySelectorAll('input[name="layerRole"]')) {
    input.addEventListener("change", () => {
      if (!input.checked) return;
      selectedLayer().role = input.value;
      renderPalette();
      paintInspector();
      saveState();
      scheduleFrame();
    });
  }
  $("layerPreset").addEventListener("change", () => {
    selectedLayer().presetId = $("layerPreset").value;
    paintInspector();
    saveState();
  });
  $("modTarget").addEventListener("change", () => {
    selectedLayer().target = $("modTarget").value;
    saveState();
  });
  $("modAmount").addEventListener("input", () => {
    selectedLayer().amount = Number($("modAmount").value);
    $("modAmountOut").textContent = formatSignedPercent(selectedLayer().amount);
    saveState();
  });

  $("undoButton").addEventListener("click", () => {
    const previous = state.history.pop();
    if (!previous) return;
    state.items = previous;
    $("undoButton").disabled = state.history.length === 0;
    updateEventCount();
    saveState();
    scheduleFrame();
  });
  $("clearButton").addEventListener("click", () => {
    if (!state.items.length) return;
    pushHistory();
    state.items = [];
    updateEventCount();
    saveState();
    scheduleFrame();
    announce("Painting cleared.");
  });

  window.addEventListener("keydown", (event) => {
    if (event.code !== "Space" || /INPUT|SELECT|BUTTON/.test(document.activeElement?.tagName ?? "")) return;
    event.preventDefault();
    if (state.playing) pausePlayback();
    else startPlayback();
  });
}

function drawGrid() {
  context.strokeStyle = "rgba(220, 231, 227, .07)";
  context.lineWidth = 1;
  for (let subdivision = 0; subdivision <= state.beats * 4; subdivision += 1) {
    const x = subdivision / (state.beats * 4) * cssWidth;
    context.globalAlpha = subdivision % 4 === 0 ? 1 : .45;
    context.beginPath();
    context.moveTo(x, 0);
    context.lineTo(x, cssHeight);
    context.stroke();
  }
  context.globalAlpha = 1;
  for (const frequency of [20, 50, 100, 250, 500, 1_000, 2_000, 4_000, 8_000, 16_000]) {
    if (frequency < state.rangeMin || frequency > state.rangeMax) continue;
    const position = linearDrumPositionAtFrequency(frequency, state.rangeMin, state.rangeMax);
    const y = (1 - position) * cssHeight;
    context.beginPath();
    context.moveTo(0, y);
    context.lineTo(cssWidth, y);
    context.stroke();
  }
}

function drawPaintItem(item, alpha = 1) {
  const layer = layerAt(item.layer);
  context.save();
  context.strokeStyle = layer.color;
  context.fillStyle = layer.color;
  context.globalAlpha = alpha * (layer.role === "mod" ? .66 : .9);
  context.lineWidth = item.layer === state.selectedLayer ? 2 : 1.35;
  if (layer.role === "mod") context.setLineDash([5, 5]);

  if (item.type === "hit") {
    const radius = Math.max(4, item.radius * Math.min(cssWidth, cssHeight));
    context.beginPath();
    context.arc(item.x * cssWidth, (1 - item.y) * cssHeight, radius, 0, Math.PI * 2);
    context.fill();
    context.globalAlpha *= .45;
    context.beginPath();
    context.arc(item.x * cssWidth, (1 - item.y) * cssHeight, radius + 4, 0, Math.PI * 2);
    context.stroke();
  } else if (item.type === "ring") {
    context.beginPath();
    context.ellipse(
      item.x * cssWidth,
      (1 - item.y) * cssHeight,
      item.radiusX * cssWidth,
      item.radiusY * cssHeight,
      0,
      0,
      Math.PI * 2,
    );
    context.stroke();
  } else {
    context.beginPath();
    item.points.forEach((point, index) => {
      const x = point.x * cssWidth;
      const y = (1 - point.y) * cssHeight;
      if (!index) context.moveTo(x, y);
      else context.lineTo(x, y);
    });
    context.lineJoin = "round";
    context.lineCap = "round";
    context.stroke();
  }
  context.restore();
}

function drawStage(timestamp) {
  scheduledFrame = 0;
  context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
  context.fillStyle = "#080b0c";
  context.fillRect(0, 0, cssWidth, cssHeight);
  drawGrid();

  for (const item of state.items) drawPaintItem(item);
  if (state.draft) drawPaintItem(sanitizePaintItem(state.draft, state.draft.id), .7);

  pulses = pulses.filter(({ startedAt }) => timestamp - startedAt < 620);
  for (const pulse of pulses) {
    const age = (timestamp - pulse.startedAt) / 620;
    const x = pulse.phase * cssWidth;
    const y = (1 - pulse.vertical) * cssHeight;
    context.globalAlpha = 1 - age;
    context.strokeStyle = pulse.color;
    context.lineWidth = 1.25;
    context.beginPath();
    context.arc(x, y, 5 + age * 28 * pulse.velocity, 0, Math.PI * 2);
    context.stroke();
  }
  context.globalAlpha = 1;

  const playheadX = state.phase * cssWidth;
  context.strokeStyle = "rgba(104, 223, 188, .92)";
  context.lineWidth = 1.25;
  context.beginPath();
  context.moveTo(playheadX, 0);
  context.lineTo(playheadX, cssHeight);
  context.stroke();
  context.fillStyle = "#68dfbc";
  context.beginPath();
  context.moveTo(playheadX - 4, 0);
  context.lineTo(playheadX + 4, 0);
  context.lineTo(playheadX, 7);
  context.closePath();
  context.fill();

  if (pulses.length || state.playing || state.pointerActive) scheduleFrame();
}

function scheduleFrame() {
  if (!scheduledFrame) scheduledFrame = requestAnimationFrame(drawStage);
}

function resizeCanvas() {
  const bounds = stageWrap.getBoundingClientRect();
  cssWidth = Math.max(1, Math.round(bounds.width));
  cssHeight = Math.max(1, Math.round(bounds.height));
  pixelRatio = Math.max(1, Math.min(
    window.devicePixelRatio || 1,
    2,
    Math.sqrt(2_800_000 / (cssWidth * cssHeight)),
  ));
  canvas.width = Math.round(cssWidth * pixelRatio);
  canvas.height = Math.round(cssHeight * pixelRatio);
  if (scheduledFrame) cancelAnimationFrame(scheduledFrame);
  scheduledFrame = 0;
  drawStage(performance.now());
}

restoreState();
renderPresetOptions();
renderPalette();
paintInspector();
renderFrequencyAxis();
renderTimeAxis();
updateControlReadouts();
bindControls();
setTool(state.tool);
paintTransport();
new ResizeObserver(resizeCanvas).observe(stageWrap);
resizeCanvas();

window.addEventListener("pagehide", () => {
  stopPlayback();
  audioLifecycleGeneration += 1;
  setAudioState(false);
  void audio.close();
});

import {
  cloneDefaultFmDrumVoices,
  FM_DRUM_STORAGE_KEY,
  FmDrumAudio,
  sanitizeFmDrumVoice,
} from "./src/fm-drums.js";
import {
  L_SYSTEM_PRESETS,
  advanceLSystemTraversal,
  iterationPlaybackAtPhase,
  iterationPlaybackPhaseRate,
  traceLSystem,
} from "./src/l-system.js";
import {
  L_SYSTEM_DRUM_MAPPING_MODES,
  lSystemDrumEventsForPlayheads,
  lSystemDrumSubdivisionCount,
  lSystemDrumVoiceIndex,
  mappedLSystemDrumVoice,
} from "./src/l-system-drums.js";

const $ = (id) => document.getElementById(id);
const TAU = Math.PI * 2;
const canvas = $("stage");
const stageWrap = $("stageWrap");
const context = canvas.getContext("2d", { desynchronized: true });
const MIN_TRAVERSAL_SPEED = 0.01;
const MAX_TRAVERSAL_SPEED = 4;
const TRAVERSAL_SPEED_CURVE = 3;
const DEFAULT_L_SYSTEM_DRUM_STATE = Object.freeze({
  presetId: "pythagorean",
  iterations: 7,
  angle: 45,
  turnAsymmetry: 0,
  lengthScale: 0.72,
  position: 0,
  speed: 0.3,
  direction: 1,
  traversalBehavior: "loop",
  structureMode: "final",
  playing: false,
  audio: false,
  output: 0.62,
  subdivisions: 4,
  mappingMode: "branch-depth-turn",
  pitchDepth: 12,
  characterDepth: 0.72,
});

const presetById = new Map(L_SYSTEM_PRESETS.map((preset) => [preset.id, preset]));
const mappingById = new Map(L_SYSTEM_DRUM_MAPPING_MODES.map((mode) => [mode.id, mode]));
const audio = new FmDrumAudio(globalThis);
const state = { ...DEFAULT_L_SYSTEM_DRUM_STATE };
const voices = loadDrumBank();
let cssWidth = 1;
let cssHeight = 1;
let pixelRatio = 1;
let scheduledFrame = 0;
let lastFrameTime = performance.now();
let activeEventKeys = new Set();
let hitCount = 0;
let iterationTraces = buildIterationTraces(L_SYSTEM_PRESETS[0], state.iterations);

function buildIterationTraces(preset, iterations, overrides = {}) {
  const finalIteration = Math.max(0, Math.floor(iterations));
  const iterationNumbers = finalIteration > 0
    ? Array.from({ length: finalIteration }, (_, index) => index + 1)
    : [0];
  return iterationNumbers.map((iteration) => ({
    ...traceLSystem({ ...preset, ...overrides, iterations: iteration }),
    iteration,
  }));
}

function loadDrumBank() {
  const fallback = cloneDefaultFmDrumVoices();
  try {
    const stored = JSON.parse(localStorage.getItem(FM_DRUM_STORAGE_KEY));
    if (!Array.isArray(stored) || stored.length !== fallback.length) return fallback;
    return fallback.map((voice, index) => sanitizeFmDrumVoice({
      ...voice,
      ...stored[index],
      id: voice.id,
      key: voice.key,
      name: voice.name,
      family: voice.family,
      color: voice.color,
    }));
  } catch {
    return fallback;
  }
}

function setPressed(element, pressed) {
  element.setAttribute("aria-pressed", String(Boolean(pressed)));
}

function scheduleFrame() {
  if (!scheduledFrame) scheduledFrame = requestAnimationFrame(frame);
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
  const paint = () => { output.textContent = formatter(state[key]); };
  input.value = String(state[key]);
  input.addEventListener("input", () => {
    state[key] = Number(input.value);
    paint();
    afterChange?.();
    scheduleFrame();
  });
  paint();
}

bindRange("position", "position", (value) => `${(value * 100).toFixed(1)}%`, () => {
  activeEventKeys = new Set();
});
bindRange("output", "output", (value) => `${Math.round(value * 100)}%`, () => {
  audio.setOutput(state.audio ? state.output : 0);
});
bindRange("iterations", "iterations", (value) => String(Math.round(value)), rebuildTrace);
bindRange("angle", "angle", (value) => `${Number(value.toFixed(1))}°`, () => {
  paintGrowthCapabilities();
  rebuildTrace();
});
bindRange("turnAsymmetry", "turnAsymmetry", formatTurnPair, rebuildTrace);
bindRange("lengthScale", "lengthScale", (value) => `${Math.round(value * 100)}%`, () => {
  paintGrowthCapabilities();
  rebuildTrace();
});
bindRange("subdivisions", "subdivisions", (value) => String(lSystemDrumSubdivisionCount(value)), () => {
  state.subdivisions = lSystemDrumSubdivisionCount(state.subdivisions);
  activeEventKeys = new Set();
  paintMapping();
});
bindRange("pitchDepth", "pitchDepth", (value) => `${Math.round(value)} st`);
bindRange("characterDepth", "characterDepth", (value) => `${Math.round(value * 100)}%`);

function traversalSpeedFromSlider(position) {
  const amount = Math.min(1, Math.max(0, Number(position) || 0));
  return MIN_TRAVERSAL_SPEED
    + (MAX_TRAVERSAL_SPEED - MIN_TRAVERSAL_SPEED)
      * amount ** TRAVERSAL_SPEED_CURVE;
}

function traversalSliderFromSpeed(speed) {
  const normalized = (
    Math.min(MAX_TRAVERSAL_SPEED, Math.max(MIN_TRAVERSAL_SPEED, Number(speed) || MIN_TRAVERSAL_SPEED))
      - MIN_TRAVERSAL_SPEED
  ) / (MAX_TRAVERSAL_SPEED - MIN_TRAVERSAL_SPEED);
  return normalized ** (1 / TRAVERSAL_SPEED_CURVE);
}

function formatTraversalSpeed(speed = state.speed) {
  return `${speed.toFixed(2)} cyc/s`;
}

function paintTraversalSpeed() {
  const input = $("speed");
  input.value = String(traversalSliderFromSpeed(state.speed));
  $("speedOut").textContent = formatTraversalSpeed();
  input.setAttribute("aria-valuetext", `${state.speed.toFixed(2)} cycles per second`);
}

$("speed").addEventListener("input", (event) => {
  state.speed = traversalSpeedFromSlider(event.currentTarget.value);
  paintTraversalSpeed();
  paintCurrentSettings();
  scheduleFrame();
});

function currentPreset() {
  return presetById.get(state.presetId) ?? L_SYSTEM_PRESETS[0];
}

function formatAngle(value) {
  return Number(value.toFixed(1));
}

function formatTurnPair(asymmetry) {
  const minusTurn = state.angle * (1 - asymmetry);
  const plusTurn = state.angle * (1 + asymmetry);
  return `-${formatAngle(minusTurn)}° / +${formatAngle(plusTurn)}°`;
}

function paintGrowthCapabilities() {
  const preset = currentPreset();
  const grammar = `${preset.axiom}${Object.values(preset.rules).join("")}`;
  const hasTurns = /[+-]/.test(grammar);
  const hasTaper = /[<>]/.test(grammar);
  $("turnAsymmetry").disabled = !hasTurns;
  $("turnAsymmetryOut").textContent = hasTurns ? formatTurnPair(state.turnAsymmetry) : "not used";
  $("turnAsymmetryNote").textContent = hasTurns
    ? "Makes + and - turns unequal while preserving their total opening."
    : "This grammar has no + or - turns, so angle and turn asymmetry are not used.";
  $("angle").disabled = !hasTurns;
  $("angleOut").textContent = hasTurns ? `${formatAngle(state.angle)}°` : "not used";
  $("lengthScale").disabled = !hasTaper;
  $("lengthScaleOut").textContent = hasTaper
    ? `${Math.round(state.lengthScale * 100)}%`
    : "not used";
  $("taperNote").textContent = hasTaper
    ? `${Math.round(state.lengthScale * 100)}% means each >-marked level is ${state.lengthScale.toFixed(2)}x as long; < restores it.`
    : "This grammar has no > or < length markers, so taper is not used.";
}

function paintGrammar() {
  const preset = currentPreset();
  $("axiomReadout").textContent = preset.axiom;
  $("rulesReadout").textContent = Object.entries(preset.rules)
    .map(([symbol, replacement]) => `${symbol} -> ${replacement}`)
    .join(" · ");
  $("iterations").max = String(preset.maxIterations ?? 12);
  $("systemSummary").textContent = preset.name;
  paintGrowthCapabilities();
}

function rebuildTrace() {
  const preset = currentPreset();
  try {
    iterationTraces = buildIterationTraces(preset, state.iterations, {
      angle: state.angle,
      turnAsymmetry: state.turnAsymmetry,
      lengthScale: state.lengthScale,
    });
    $("systemError").hidden = true;
    activeEventKeys = new Set();
    paintStructure();
  } catch (error) {
    $("systemError").textContent = error instanceof Error ? error.message : "This grammar is too large to draw.";
    $("systemError").hidden = false;
  }
  scheduleFrame();
}

function loadPreset(id) {
  const preset = presetById.get(id) ?? L_SYSTEM_PRESETS[0];
  state.presetId = preset.id;
  state.iterations = preset.iterations;
  state.angle = preset.angle;
  state.turnAsymmetry = preset.turnAsymmetry ?? 0;
  state.lengthScale = preset.lengthScale;
  $("preset").value = preset.id;
  $("iterations").max = String(preset.maxIterations ?? 12);
  $("iterations").value = String(state.iterations);
  $("iterationsOut").textContent = String(state.iterations);
  $("angle").value = String(state.angle);
  $("angleOut").textContent = `${state.angle}°`;
  $("turnAsymmetry").value = String(state.turnAsymmetry);
  $("turnAsymmetryOut").textContent = formatTurnPair(state.turnAsymmetry);
  $("lengthScale").value = String(state.lengthScale);
  $("lengthScaleOut").textContent = `${Math.round(state.lengthScale * 100)}%`;
  paintGrammar();
  rebuildTrace();
}

$("preset").addEventListener("change", (event) => loadPreset(event.currentTarget.value));
$("resetSystem").addEventListener("click", () => loadPreset(state.presetId));

const structureDescriptions = {
  final: "Read the final expanded tree as one branching trigger path.",
  sequence: "Read I1 through the selected iteration in order.",
  together: "Start every iteration together at the same normalized path position.",
  accumulate: "Build the relationship in equal-time steps through the selected iteration.",
  canon: "Loop every iteration together, evenly offset in phase.",
};
const structureLabels = {
  final: "final tree",
  sequence: "in sequence",
  together: "together",
  accumulate: "accumulate",
  canon: "canon",
};

function iterationChain(separator) {
  return iterationTraces.map((item) => `I${item.iteration}`).join(separator);
}

function paintStructure(playback = iterationPlaybackAtPhase(
  iterationTraces,
  state.position,
  state.structureMode,
)) {
  const finalIteration = iterationTraces.at(-1)?.iteration ?? 0;
  const activeIteration = playback.activeIteration ?? playback.entries[0]?.iteration ?? finalIteration;
  if (state.structureMode === "sequence") {
    $("structureSummary").textContent = `sequence · I${activeIteration}/${finalIteration}`;
    $("structureReadout").textContent = `${iterationChain(" -> ")} · equal time`;
  } else if (state.structureMode === "together") {
    $("structureSummary").textContent = `together · ${iterationTraces.length} iterations`;
    $("structureReadout").textContent = `${iterationChain(" + ")} · phase locked`;
  } else if (state.structureMode === "accumulate") {
    $("structureSummary").textContent = `accumulate · through I${activeIteration}`;
    $("structureReadout").textContent = `${iterationChain(" -> ")} · additive`;
  } else if (state.structureMode === "canon") {
    $("structureSummary").textContent = `canon · ${iterationTraces.length} iterations`;
    $("structureReadout").textContent = `${iterationChain(" + ")} · staggered`;
  } else {
    $("structureSummary").textContent = `final · I${finalIteration}`;
    $("structureReadout").textContent = `I${finalIteration} only`;
  }
  $("structureDescription").textContent = structureDescriptions[state.structureMode];
  paintTraversalSpeed();
  paintCurrentSettings();
}

$("structureMode").addEventListener("change", (event) => {
  state.structureMode = structureDescriptions[event.currentTarget.value]
    ? event.currentTarget.value
    : "final";
  activeEventKeys = new Set();
  paintStructure();
  scheduleFrame();
});

function paintTraversalBehavior() {
  setPressed($("traversalLoop"), state.traversalBehavior === "loop");
  setPressed($("traversalPingPong"), state.traversalBehavior === "ping-pong");
  paintCurrentSettings();
}

$("traversalLoop").addEventListener("click", () => {
  state.traversalBehavior = "loop";
  activeEventKeys = new Set();
  paintTraversalBehavior();
  scheduleFrame();
});

$("traversalPingPong").addEventListener("click", () => {
  state.traversalBehavior = "ping-pong";
  activeEventKeys = new Set();
  paintTraversalBehavior();
  scheduleFrame();
});

function mappingLabel() {
  const mode = mappingById.get(state.mappingMode) ?? L_SYSTEM_DRUM_MAPPING_MODES[0];
  return mode.label.toLowerCase();
}

function paintMapping() {
  const mode = mappingById.get(state.mappingMode) ?? L_SYSTEM_DRUM_MAPPING_MODES[0];
  $("mappingMode").value = mode.id;
  $("mappingDescription").textContent = mode.description;
  mode.legend.forEach((entry, index) => {
    $(`mappingLegendLabel${index}`).textContent = entry.label;
    $(`mappingLegendDetail${index}`).textContent = entry.detail;
  });
  $("drumMap").dataset.mappingMode = mode.id;
  $("mappingSummary").textContent = `${mappingLabel()} · ${state.subdivisions}/branch`;
  paintCurrentSettings();
}

$("mappingMode").addEventListener("change", (event) => {
  state.mappingMode = mappingById.has(event.currentTarget.value)
    ? event.currentTarget.value
    : "branch-depth-turn";
  activeEventKeys = new Set();
  paintMapping();
  scheduleFrame();
});

function paintCurrentSettings() {
  const behavior = state.traversalBehavior === "ping-pong"
    ? "ping-pong"
    : state.direction > 0
      ? "loop forward"
      : "loop reverse";
  $("currentSettingsSummary").textContent = `${
    structureLabels[state.structureMode] ?? structureLabels.final
  } · ${formatTraversalSpeed()}`;
  $("currentTraversalReadout").textContent = [
    formatTraversalSpeed(),
    behavior,
  ].join(" · ");
  $("currentDrumReadout").textContent = `${mappingLabel()} · ${state.subdivisions}/branch`;
}

function setAudioUi(enabled) {
  state.audio = Boolean(enabled);
  setPressed($("audioButton"), state.audio);
  $("audioState").textContent = state.audio ? "on" : "off";
  audio.setOutput(state.audio ? state.output : 0);
}

$("audioButton").addEventListener("click", async () => {
  $("audioError").hidden = true;
  if (state.audio) {
    setAudioUi(false);
    await audio.close();
    activeEventKeys = new Set();
    scheduleFrame();
    return;
  }
  try {
    await audio.start();
    setAudioUi(true);
  } catch (error) {
    $("audioError").textContent = error instanceof Error ? error.message : "Web Audio could not start.";
    $("audioError").hidden = false;
    setAudioUi(false);
  }
  activeEventKeys = new Set();
  scheduleFrame();
});

$("playButton").addEventListener("click", () => {
  state.playing = !state.playing;
  setPressed($("playButton"), state.playing);
  activeEventKeys = new Set();
  lastFrameTime = performance.now();
  scheduleFrame();
});

$("directionButton").addEventListener("click", () => {
  state.direction *= -1;
  $("directionButton").textContent = `Direction · ${state.direction > 0 ? "forward" : "reverse"}`;
  activeEventKeys = new Set();
  paintCurrentSettings();
  scheduleFrame();
});

function renderDrumMap() {
  $("drumMap").innerHTML = voices.map((voice, index) => (
    `<button class="l-system-drum-cell" type="button" data-voice-index="${index}" data-voice-id="${voice.id}" style="--voice-color: ${voice.color}">`
      + `<b>${voice.name}</b><small>${voice.key.toUpperCase()} · ${voice.family}</small>`
      + "</button>"
  )).join("");
  for (const button of $("drumMap").querySelectorAll(".l-system-drum-cell")) {
    button.addEventListener("click", () => {
      const voice = voices[Number(button.dataset.voiceIndex) || 0];
      if (!state.audio) setAudioUi(true);
      audio.trigger(voice).catch((error) => {
        showError(error);
        setAudioUi(false);
      });
      flashVoice(Number(button.dataset.voiceIndex) || 0);
    });
  }
}

function flashVoice(index) {
  const cell = $("drumMap").querySelector(`[data-voice-index="${index}"]`);
  if (!cell) return;
  cell.classList.add("is-active");
  setTimeout(() => cell.classList.remove("is-active"), 180);
}

function showError(error) {
  $("audioError").textContent = error instanceof Error ? error.message : String(error);
  $("audioError").hidden = false;
}

function triggerEvent(event, eventCount) {
  const voiceIndex = lSystemDrumVoiceIndex(event, { mode: state.mappingMode });
  const voice = mappedLSystemDrumVoice(voices[voiceIndex], event, {
    pitchDepth: state.pitchDepth,
    characterDepth: state.characterDepth,
    eventCount,
  });
  hitCount += 1;
  $("mappingReadout").textContent = [
    `I${event.iteration}`,
    `SEG ${event.segmentIndex}`,
    `SUB ${event.subdivisionIndex + 1}/${event.subdivisions}`,
    `-> ${voice.name}`,
    `HITS ${hitCount}`,
  ].join(" · ");
  audio.trigger(voice).catch(showError);
  flashVoice(voiceIndex);
}

function playbackBounds(entries) {
  return entries.reduce((bounds, entry) => ({
    minX: Math.min(bounds.minX, entry.trace.bounds.minX),
    maxX: Math.max(bounds.maxX, entry.trace.bounds.maxX),
    minY: Math.min(bounds.minY, entry.trace.bounds.minY),
    maxY: Math.max(bounds.maxY, entry.trace.bounds.maxY),
  }), { minX: 0, maxX: 0, minY: 0, maxY: 0 });
}

function drawingTransform(bounds) {
  const margin = Math.max(22, Math.min(cssWidth, cssHeight) * 0.075);
  const dataWidth = Math.max(1e-9, bounds.maxX - bounds.minX);
  const dataHeight = Math.max(1e-9, bounds.maxY - bounds.minY);
  const scale = Math.min(
    Math.max(1, cssWidth - margin * 2) / dataWidth,
    Math.max(1, cssHeight - margin * 2) / dataHeight,
  );
  const drawnWidth = dataWidth * scale;
  const drawnHeight = dataHeight * scale;
  return {
    scale,
    x: (point) => (cssWidth - drawnWidth) * 0.5 + (point.x - bounds.minX) * scale,
    y: (point) => (cssHeight + drawnHeight) * 0.5 - (point.y - bounds.minY) * scale,
  };
}

function drawSegment(segment, transform, strokeStyle, lineWidth = 1) {
  context.beginPath();
  context.moveTo(transform.x(segment.start), transform.y(segment.start));
  context.lineTo(transform.x(segment.end), transform.y(segment.end));
  context.strokeStyle = strokeStyle;
  context.lineWidth = lineWidth;
  context.stroke();
}

function playbackHeads(playback) {
  return playback.entries.flatMap((entry) => entry.snapshot.heads.map((head) => ({
    ...head,
    iteration: entry.iteration,
    localPhase: entry.localPhase,
    sourceTrace: entry.trace,
    snapshotDistance: entry.snapshot.distance,
  })));
}

function drawScene(playback, playheads) {
  context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
  context.clearRect(0, 0, cssWidth, cssHeight);
  const transform = drawingTransform(playbackBounds(playback.entries));
  const layered = playback.entries.length > 1;
  playback.entries.forEach((entry, entryIndex) => {
    const sourceDepth = Math.max(1, entry.trace.maxForkDepth);
    const iterationHue = 88 + entryIndex * 130 / Math.max(1, playback.entries.length - 1);
    entry.trace.segments.forEach((segment) => {
      const depth = segment.forkDepth / sourceDepth;
      const completed = segment.endDistance <= entry.snapshot.distance;
      drawSegment(
        segment,
        transform,
        completed
          ? `hsla(${iterationHue + depth * 52}, 78%, 68%, ${layered ? 0.28 : 0.68 + depth * 0.18})`
          : `rgba(214, 232, 226, ${layered ? 0.035 : 0.1 + depth * 0.12})`,
        layered ? Math.max(0.45, 0.9 - depth * 0.25) : Math.max(0.65, 1.35 - depth * 0.55),
      );
    });
  });

  const headRadius = Math.max(1.6, 5 - Math.log2(Math.max(1, playheads.length)) * 0.42);
  for (const playhead of playheads) {
    const depth = playhead.depth / Math.max(1, playhead.sourceTrace.maxForkDepth);
    const partial = { start: playhead.segment.start, end: playhead };
    drawSegment(
      partial,
      transform,
      `hsla(${95 + depth * 82}, 84%, 73%, .95)`,
      Math.max(1, 2.2 - depth * 0.45),
    );
    const x = transform.x(playhead);
    const y = transform.y(playhead);
    context.save();
    context.shadowColor = "#b8df77";
    context.shadowBlur = playheads.length <= 32 ? 18 : 8;
    context.beginPath();
    context.arc(x, y, headRadius, 0, TAU);
    context.fillStyle = "#fff3d6";
    context.fill();
    context.restore();
  }
}

function drawableTraversalPhase(position) {
  return state.traversalBehavior === "ping-pong" && position >= 1
    ? 1 - 1e-9
    : position;
}

function frame(now) {
  scheduledFrame = 0;
  const delta = Math.min(1, Math.max(0, (now - lastFrameTime) / 1_000));
  lastFrameTime = now;
  const phaseRate = iterationPlaybackPhaseRate(
    state.structureMode,
    iterationTraces.length,
    state.speed,
  );
  if (state.playing) {
    const advanced = advanceLSystemTraversal(
      state.position,
      state.direction,
      phaseRate * delta,
      state.traversalBehavior,
    );
    state.position = advanced.position;
    if (advanced.direction !== state.direction) {
      state.direction = advanced.direction;
      $("directionButton").textContent = `Direction · ${state.direction > 0 ? "forward" : "reverse"}`;
    }
  }
  const playback = iterationPlaybackAtPhase(
    iterationTraces,
    drawableTraversalPhase(state.position),
    state.structureMode,
  );
  const playheads = playbackHeads(playback);
  drawScene(playback, playheads);

  if (state.audio && state.playing) {
    const events = lSystemDrumEventsForPlayheads(playheads, {
      subdivisions: state.subdivisions,
      direction: state.direction,
    });
    const nextKeys = new Set(events.map((event) => event.key));
    for (const event of events) {
      if (!activeEventKeys.has(event.key)) triggerEvent(event, events.length);
    }
    activeEventKeys = nextKeys;
  } else {
    activeEventKeys = new Set();
  }

  $("position").value = String(state.position);
  $("positionOut").textContent = state.structureMode === "sequence"
    ? `I${playback.activeIteration} · ${(playback.entries[0].localPhase * 100).toFixed(1)}%`
    : state.structureMode === "accumulate"
      ? `to I${playback.activeIteration} · ${(playback.entries[0].localPhase * 100).toFixed(1)}%`
      : state.structureMode === "together"
        ? `sync · ${(state.position * 100).toFixed(1)}%`
        : state.structureMode === "canon"
          ? `round · ${(state.position * 100).toFixed(1)}%`
          : `${(state.position * 100).toFixed(1)}%`;

  const finalIteration = iterationTraces.at(-1)?.iteration ?? 0;
  const structureLabel = state.structureMode === "sequence"
    ? `I${playback.activeIteration}/${finalIteration}`
    : state.structureMode === "together"
      ? `${iterationTraces.length} ITERATIONS TOGETHER`
      : state.structureMode === "accumulate"
        ? `ACCUMULATE THROUGH I${playback.activeIteration}`
        : state.structureMode === "canon"
          ? `${iterationTraces.length} ITERATION CANON`
          : `FINAL I${finalIteration}`;
  const preset = currentPreset();
  const headLabel = `${playheads.length} HEAD${playheads.length === 1 ? "" : "S"}`;
  const audioText = state.audio ? (state.playing ? `${hitCount} HITS` : "AUDIO READY") : "AUDIO OFF";
  $("playSummary").textContent = `${headLabel.toLowerCase()} · ${state.playing ? "playing" : "paused"}`;
  $("stageReadout").textContent = `${preset.name.toUpperCase()} · ${structureLabel} · ${headLabel} · ${audioText}`;
  paintStructure(playback);
  if (state.playing) scheduleFrame();
}

canvas.addEventListener("keydown", (event) => {
  if (!["ArrowLeft", "ArrowRight", " "].includes(event.key)) return;
  if (event.key === " ") {
    $("playButton").click();
  } else {
    state.position = ((state.position + (event.key === "ArrowRight" ? 0.005 : -0.005)) % 1 + 1) % 1;
    activeEventKeys = new Set();
    scheduleFrame();
  }
  event.preventDefault();
});

$("resetAll").addEventListener("click", () => {
  Object.assign(state, DEFAULT_L_SYSTEM_DRUM_STATE);
  setAudioUi(false);
  audio.close().catch(() => {});
  activeEventKeys = new Set();
  hitCount = 0;
  for (const [id, value, text] of [
    ["position", state.position, "0.0%"],
    ["output", state.output, `${Math.round(state.output * 100)}%`],
    ["subdivisions", state.subdivisions, String(state.subdivisions)],
    ["pitchDepth", state.pitchDepth, `${state.pitchDepth} st`],
    ["characterDepth", state.characterDepth, `${Math.round(state.characterDepth * 100)}%`],
  ]) {
    $(id).value = String(value);
    $(`${id}Out`).textContent = text;
  }
  $("structureMode").value = state.structureMode;
  $("mappingMode").value = state.mappingMode;
  $("directionButton").textContent = "Direction · forward";
  setPressed($("playButton"), false);
  paintTraversalSpeed();
  paintTraversalBehavior();
  paintMapping();
  loadPreset(state.presetId);
  scheduleFrame();
});

window.addEventListener("pagehide", () => {
  audio.close().catch(() => {});
});

paintTraversalSpeed();
paintTraversalBehavior();
paintGrammar();
paintStructure();
paintMapping();
renderDrumMap();
scheduleFrame();

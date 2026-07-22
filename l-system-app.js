import {
  VoicePool,
  clamp,
  pitch01ToFrequency,
  synthParametersForMode,
} from "./src/audio.js";
import {
  L_SYSTEM_PRESETS,
  allocateIterationVoiceHeads,
  branchAngleFrequency,
  branchVoiceGain,
  iterationPlaybackAtPhase,
  iterationPlaybackPhaseRate,
  normalizeLSystemPoint,
  traceLSystem,
} from "./src/l-system.js";

const $ = (id) => document.getElementById(id);
const TAU = Math.PI * 2;
const canvas = $("stage");
const stageWrap = $("stageWrap");
const context = canvas.getContext("2d", { desynchronized: true });
const MAX_L_SYSTEM_VOICES = 128;
const pool = new VoicePool(MAX_L_SYSTEM_VOICES);
const presetById = new Map(L_SYSTEM_PRESETS.map((preset) => [preset.id, preset]));
const generationLimits = { pythagorean: 11, plant: 6, coral: 5, dragon: 15 };
const state = {
  presetId: "pythagorean",
  iterations: 7,
  angle: 45,
  lengthScale: 0.72,
  position: 0,
  continuousPosition: 0,
  speed: 0.08,
  direction: 1,
  playing: false,
  audio: false,
  level: 0.55,
  pitchSource: "angle",
  baseFrequency: 110,
  pitchRange: 2,
  depthAmount: 0.65,
  soundMode: "sine",
  modulationIndex: 3,
  structureMode: "final",
};

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

let iterationTraces = buildIterationTraces(L_SYSTEM_PRESETS[0], state.iterations);
let cssWidth = 1;
let cssHeight = 1;
let pixelRatio = 1;
let scheduledFrame = 0;
let lastFrameTime = performance.now();
let lastAudioTime = null;

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
  const wrapped = ((state.continuousPosition % 1) + 1) % 1;
  state.continuousPosition += state.position - wrapped;
});
bindRange("speed", "speed", (value) => (
  ["sequence", "accumulate"].includes(state.structureMode)
    ? `${value.toFixed(2)} iter/s`
    : `${value.toFixed(2)} cyc/s`
));
bindRange("level", "level", (value) => `${Math.round(value * 100)}%`, () => pool.setLevel(state.level));
bindRange("iterations", "iterations", (value) => String(Math.round(value)), rebuildTrace);
bindRange("angle", "angle", (value) => `${Number(value.toFixed(1))}°`, rebuildTrace);
bindRange("lengthScale", "lengthScale", (value) => `${Math.round(value * 100)}%`, rebuildTrace);
bindRange("baseFrequency", "baseFrequency", (value) => `${Math.round(value)} Hz`);
bindRange("pitchRange", "pitchRange", (value) => (
  state.pitchSource === "angle" ? `${value.toFixed(2)} oct / turn` : `${value.toFixed(2)} oct`
));
bindRange("depthAmount", "depthAmount", (value) => `${Math.round(value * 100)}%`);
bindRange("modulationIndex", "modulationIndex", (value) => `${value.toFixed(2)} max`);

function currentPreset() {
  return presetById.get(state.presetId) ?? L_SYSTEM_PRESETS[0];
}

function paintGrammar() {
  const preset = currentPreset();
  $("axiomReadout").textContent = preset.axiom;
  $("rulesReadout").textContent = Object.entries(preset.rules)
    .map(([symbol, replacement]) => `${symbol} → ${replacement}`)
    .join(" · ");
  $("systemSummary").textContent = preset.name;
}

function rebuildTrace() {
  const preset = currentPreset();
  try {
    iterationTraces = buildIterationTraces(preset, state.iterations, {
      angle: state.angle,
      lengthScale: state.lengthScale,
    });
    $("systemError").hidden = true;
    pool.silence();
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
  state.lengthScale = preset.lengthScale;
  $("preset").value = preset.id;
  $("iterations").max = String(generationLimits[preset.id] ?? 12);
  $("iterations").value = String(state.iterations);
  $("iterationsOut").textContent = String(state.iterations);
  $("angle").value = String(state.angle);
  $("angleOut").textContent = `${state.angle}°`;
  $("lengthScale").value = String(state.lengthScale);
  $("lengthScaleOut").textContent = `${Math.round(state.lengthScale * 100)}%`;
  paintGrammar();
  rebuildTrace();
}

$("preset").addEventListener("change", (event) => loadPreset(event.currentTarget.value));
$("resetSystem").addEventListener("click", () => loadPreset(state.presetId));

const structureButtons = [
  ["structureFinal", "final"],
  ["structureSequence", "sequence"],
  ["structureTogether", "together"],
  ["structureAccumulate", "accumulate"],
  ["structureCanon", "canon"],
];
const structureDescriptions = {
  final: "Read the final expanded tree as one bifurcating structure.",
  sequence: "Read I1 through the selected iteration in order. Every iteration receives exactly the same duration.",
  together: "Start every iteration together at the same normalized left-to-right position.",
  accumulate: "Build the relationship in equal-time steps: I1, then I1+I2, continuing through every selected iteration.",
  canon: "Loop every iteration together, evenly offset in phase like a structural round.",
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
    $("structureReadout").textContent = `${iterationChain(" → ")} · equal time`;
  } else if (state.structureMode === "together") {
    $("structureSummary").textContent = `together · ${iterationTraces.length} iterations`;
    $("structureReadout").textContent = `${iterationChain(" + ")} · phase locked`;
  } else if (state.structureMode === "accumulate") {
    $("structureSummary").textContent = `accumulate · through I${activeIteration}`;
    $("structureReadout").textContent = `${iterationChain(" → ")} · additive`;
  } else if (state.structureMode === "canon") {
    $("structureSummary").textContent = `canon · ${iterationTraces.length} iterations`;
    $("structureReadout").textContent = `${iterationChain(" + ")} · staggered`;
  } else {
    $("structureSummary").textContent = `final · I${finalIteration}`;
    $("structureReadout").textContent = `I${finalIteration} only`;
  }
  $("structureDescription").textContent = structureDescriptions[state.structureMode];
  $("speedOut").textContent = ["sequence", "accumulate"].includes(state.structureMode)
    ? `${state.speed.toFixed(2)} iter/s`
    : `${state.speed.toFixed(2)} cyc/s`;
}

for (const [id, mode] of structureButtons) {
  $(id).addEventListener("click", () => {
    state.structureMode = mode;
    for (const [otherId, otherMode] of structureButtons) {
      setPressed($(otherId), otherMode === mode);
    }
    paintStructure();
    scheduleFrame();
  });
}

function resetClocks() {
  lastFrameTime = performance.now();
  lastAudioTime = pool.context?.currentTime ?? null;
}

$("playButton").addEventListener("click", () => {
  state.playing = !state.playing;
  setPressed($("playButton"), state.playing);
  const headCount = playbackHeads(iterationPlaybackAtPhase(
    iterationTraces,
    state.position,
    state.structureMode,
  )).length;
  $("playSummary").textContent = `${headCount} head${headCount === 1 ? "" : "s"} · ${state.playing ? "playing" : "paused"}`;
  if (!state.playing) pool.silence();
  resetClocks();
  scheduleFrame();
});

$("directionButton").addEventListener("click", () => {
  state.direction *= -1;
  $("directionButton").textContent = `Direction · ${state.direction > 0 ? "forward" : "reverse"}`;
});

$("pitchSource").addEventListener("change", (event) => {
  state.pitchSource = event.currentTarget.value;
  const labels = {
    angle: "angle → pitch",
    height: "height → pitch",
    depth: "depth → pitch",
    progress: "path → pitch",
  };
  $("mappingSummary").textContent = labels[state.pitchSource] ?? labels.angle;
  $("pitchRangeOut").textContent = state.pitchSource === "angle"
    ? `${state.pitchRange.toFixed(2)} oct / turn`
    : `${state.pitchRange.toFixed(2)} oct`;
  scheduleFrame();
});

$("soundMode").addEventListener("change", (event) => {
  state.soundMode = event.currentTarget.value;
  $("soundSummary").textContent = state.soundMode.toUpperCase();
  pool.silence();
  scheduleFrame();
});

$("audioButton").addEventListener("click", async () => {
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
      resetClocks();
    } catch (error) {
      $("audioError").textContent = error instanceof Error ? error.message : "Web Audio could not start.";
      $("audioError").hidden = false;
    }
  }
  setPressed($("audioButton"), state.audio);
  $("audioState").textContent = state.audio ? "on" : "off";
  scheduleFrame();
});

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
    voiceKey: `iteration:${entry.iteration}:${head.voiceKey}`,
  })));
}

function drawScene(playback, playheads) {
  context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
  context.clearRect(0, 0, cssWidth, cssHeight);
  const transform = drawingTransform(playbackBounds(playback.entries));
  const layered = playback.entries.length > 1;

  playback.entries.forEach((entry, entryIndex) => {
    const sourceDepth = Math.max(1, entry.trace.maxForkDepth);
    const iterationHue = 145 + entryIndex * 145 / Math.max(1, playback.entries.length - 1);
    entry.trace.segments.forEach((segment) => {
      const depth = segment.forkDepth / sourceDepth;
      const completed = segment.endDistance <= entry.snapshot.distance;
      drawSegment(
        segment,
        transform,
        completed
          ? `hsla(${iterationHue + depth * 42}, 74%, 68%, ${layered ? 0.26 : 0.64 + depth * 0.28})`
          : `rgba(214, 232, 226, ${layered ? 0.035 : 0.1 + depth * 0.14})`,
        layered ? Math.max(0.45, 0.9 - depth * 0.25) : Math.max(0.65, 1.35 - depth * 0.55),
      );
    });
  });

  const headRadius = Math.max(1.6, 5 - Math.log2(Math.max(1, playheads.length)) * 0.42);
  for (const playhead of playheads) {
    const depth = playhead.depth / Math.max(1, playhead.sourceTrace.maxForkDepth);
    const iterationIndex = playback.entries.findIndex((entry) => entry.iteration === playhead.iteration);
    const iterationHue = 145 + Math.max(0, iterationIndex) * 145 / Math.max(1, playback.entries.length - 1);
    const partial = { start: playhead.segment.start, end: playhead };
    drawSegment(
      partial,
      transform,
      `hsla(${iterationHue + depth * 42}, 84%, 73%, .95)`,
      Math.max(1, 2.2 - depth * 0.45),
    );
    const x = transform.x(playhead);
    const y = transform.y(playhead);
    context.save();
    context.shadowColor = "#5fe8c4";
    context.shadowBlur = playheads.length <= 32 ? 18 : 8;
    context.beginPath();
    context.arc(x, y, headRadius, 0, TAU);
    context.fillStyle = "#fff3d6";
    context.fill();
    context.restore();
  }
}

function pitchValue(playhead, normalized) {
  if (state.pitchSource === "angle") return null;
  if (state.pitchSource === "depth") {
    return playhead.depth / Math.max(1, playhead.sourceTrace.maxForkDepth);
  }
  if (state.pitchSource === "progress") return playhead.localPhase;
  return normalized.y;
}

function voiceForPlayhead(playhead, activePower, combinedGain) {
  const normalized = normalizeLSystemPoint(playhead, playhead.sourceTrace.bounds);
  const depth = playhead.depth / Math.max(1, playhead.sourceTrace.maxForkDepth);
  const drive = clamp(depth * state.depthAmount, 0, 1);
  const mappedPitch = pitchValue(playhead, normalized);
  const frequency = state.pitchSource === "angle"
    ? branchAngleFrequency(playhead.cumulativeTurn, state.baseFrequency, state.pitchRange)
    : pitch01ToFrequency(mappedPitch, state.baseFrequency, state.pitchRange);
  return {
    key: `l-system:${playhead.voiceKey}`,
    frequency,
    gain: branchVoiceGain(playhead.powerShare, activePower, combinedGain),
    pan: clamp(normalized.x * 2 - 1, -1, 1),
    waveform: "sine",
    ...synthParametersForMode(state.soundMode, drive, {
      fmIndex: state.modulationIndex,
      fmRatio: 1.5,
      pmIndex: state.modulationIndex,
      pmRatio: 1.5,
      shepardRate: state.playing ? state.speed * state.direction : 0,
      shepardWidth: 5,
      shepardPosition: state.position,
    }),
  };
}

function voicesForPlayheads(playheads) {
  const selected = allocateIterationVoiceHeads(playheads, MAX_L_SYSTEM_VOICES);
  const groups = new Map();
  for (const playhead of selected) {
    const group = groups.get(playhead.iteration) ?? [];
    group.push(playhead);
    groups.set(playhead.iteration, group);
  }
  const layerGain = 0.38 / Math.sqrt(Math.max(1, groups.size));
  return [...groups.values()].flatMap((heads) => {
    const activePower = heads.reduce((sum, playhead) => sum + playhead.powerShare, 0);
    return heads.map((playhead) => voiceForPlayhead(playhead, activePower, layerGain));
  });
}

function transportDelta(now) {
  const perfDelta = Math.max(0, (now - lastFrameTime) / 1000);
  lastFrameTime = now;
  const audioTime = state.audio && pool.context?.state === "running" ? pool.context.currentTime : null;
  const audioDelta = Number.isFinite(audioTime) && Number.isFinite(lastAudioTime) && audioTime >= lastAudioTime
    ? audioTime - lastAudioTime
    : 0;
  lastAudioTime = Number.isFinite(audioTime) ? audioTime : null;
  return Math.min(1, audioDelta > 1e-6 ? audioDelta : perfDelta);
}

function frame(now) {
  scheduledFrame = 0;
  const delta = transportDelta(now);
  const phaseRate = iterationPlaybackPhaseRate(
    state.structureMode,
    iterationTraces.length,
    state.speed,
  );
  if (state.playing) {
    state.continuousPosition += state.direction * phaseRate * delta;
    state.position = ((state.continuousPosition % 1) + 1) % 1;
  }
  const playback = iterationPlaybackAtPhase(iterationTraces, state.position, state.structureMode);
  const playheads = playbackHeads(playback);
  drawScene(playback, playheads);

  let voices = [];
  if (state.audio && state.playing && playheads.length) {
    const lookahead = 0.065;
    const futurePhase = state.continuousPosition + state.direction * phaseRate * lookahead;
    const futurePlayback = iterationPlaybackAtPhase(
      iterationTraces,
      futurePhase,
      state.structureMode,
    );
    const futureHeads = playbackHeads(futurePlayback);
    voices = voicesForPlayheads(playheads);
    pool.setVoiceTrajectory(voices, voicesForPlayheads(futureHeads), lookahead);
  } else if (state.audio) {
    pool.setVoices([]);
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
  const preset = currentPreset();
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
  const headLabel = `${playheads.length} HEAD${playheads.length === 1 ? "" : "S"}`;
  const voiceText = state.audio
    ? (state.playing ? `${voices.length} ${state.soundMode.toUpperCase()} VOICE${voices.length === 1 ? "" : "S"}` : "AUDIO READY")
    : "AUDIO OFF";
  $("playSummary").textContent = `${headLabel.toLowerCase()} · ${state.playing ? "playing" : "paused"}`;
  $("stageReadout").textContent = `${preset.name.toUpperCase()} · ${structureLabel} · ${headLabel} · ${voiceText}`;
  paintStructure(playback);
  if (state.playing) scheduleFrame();
}

canvas.addEventListener("keydown", (event) => {
  if (!["ArrowLeft", "ArrowRight"].includes(event.key)) return;
  state.position = ((state.position + (event.key === "ArrowRight" ? 0.005 : -0.005)) % 1 + 1) % 1;
  state.continuousPosition = state.position;
  scheduleFrame();
  event.preventDefault();
});

document.addEventListener("visibilitychange", () => document.hidden ? pool.silence() : scheduleFrame());
window.addEventListener("pagehide", (event) => event.persisted ? pool.disable() : void pool.close());
paintGrammar();
paintStructure();
scheduleFrame();

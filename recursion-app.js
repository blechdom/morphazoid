import { RECURSION_STUDIES, buildRecursionPlan } from "./src/recursion.js";
import { RecursiveAudioEngine } from "./src/recursion-audio-engine.js";
import {
  causalCurve,
  geometryTrace,
  stackPoint,
  torusPoint,
} from "./src/recursion-geometry.js";
import { mobiusFrequencyMap } from "./src/recursion-spectral-dsp.js";

const $ = (id) => document.getElementById(id);
const TAU = Math.PI * 2;
const LOOKAHEAD_SECONDS = 0.18;
const canvas = $("stage");
const stageWrap = $("stageWrap");
const drawing = canvas.getContext("2d", { desynchronized: true });
const audio = new RecursiveAudioEngine();
const studyById = new Map(RECURSION_STUDIES.map((study) => [study.id, study]));
const studyIds = RECURSION_STUDIES.map((study) => study.id);
const studyIndexById = new Map(studyIds.map((id, index) => [id, index]));
const reducedMotion = globalThis.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches ?? false;

const STUDY_UI = Object.freeze({
  "ouroboros-tape": Object.freeze({
    title: "Ouroboros Tape",
    premise: "The loop becomes a twisted orbit: its tail breeds new slices, rates, accents, and phrase entrances.",
    readout: "TIME-DOMAIN AUTOPHAGY",
    cue: "Track the loop splitting into orbiting fragments: every pitch bend changes the rhythm that selects the next piece of its tail.",
    summary: "four clocks eat one another",
    topology: "nested torus · output-as-input · Klein seam",
    analysis: "phrase position · rate orbit · spectral region · stereo handedness",
    rewrite: "tail slice · reverse · swap · rate bend · recursive pulse genome",
    wildness: "8–96 grains · cross-clock feedback · accumulated counter-phrases",
    depthLabel: "Generation depth",
    processKind: "BUFFER",
  }),
  "spectral-mobius": Object.freeze({
    title: "Spectral Möbius Furnace",
    premise: "A spectral sheet folds while its moving seam rewrites pitch, pulse spacing, phrase order, and handedness.",
    readout: "STFT FOLD / PHASE SEAM",
    cue: "Hear moving bands jump through multiple rates and rhythmic scales; every odd lap returns reversed, channel-swapped, and inside-out.",
    summary: "STFT folds into its underside",
    topology: "serial frequency-axis recurrence",
    analysis: "1024-point Hann STFT · 75% overlap",
    rewrite: "tent-map bin fold · branch phase inversion · iSTFT",
    wildness: "moving seam · continuous rate bends · 96-grain ancestor sheets",
    depthLabel: "Spectral generations",
    processKind: "SPECTRUM",
  }),
  "filter-hydra": Object.freeze({
    title: "Filter-Bank Hydra",
    premise: "Every spectral child grows its own pulse genome, rate curve, delay pattern, and stereo orbit.",
    readout: "BINARY FILTER TREE",
    cue: "Follow one body bursting into independent filter-rhythm creatures that interrupt and re-seed one another across the whole phrase.",
    summary: "bands grow bands",
    topology: "breadth-first complementary filter tree",
    analysis: "inherited logarithmic low / high regions",
    rewrite: "each parent appends one low-pass or high-pass child",
    wildness: "cross-rhythmic heads · moving resonance · hyperactive bounded ancestry",
    depthLabel: "Tree depth",
    processKind: "FILTER TREE",
  }),
  "cantor-delay": Object.freeze({
    title: "Cantor Delay Weather",
    premise: "Every gap breeds a different clock; pitch motion changes delay ratios and delay motion jumps to new phrase regions.",
    readout: "FINITE DELAY MYCELIUM",
    cue: "Hear nested polytempos tear holes through the phrase, then fill those holes with filtered, reversed micro-weather.",
    summary: "echoes inside echoes",
    topology: "finite binary temporal tree",
    analysis: "explicit parent delay and Cantor coordinate",
    rewrite: "two feed-forward children at contracted intervals",
    wildness: "polytempo dust · 96 moving grains · finite feed-forward storms",
    depthLabel: "Delay-tree depth",
    processKind: "DELAY FIELD",
  }),
  "convolution-maw": Object.freeze({
    title: "Self-Convolution Maw",
    premise: "The sound becomes its own room, then the room erupts into a recursively re-ordered trigger constellation.",
    readout: "SELF-CONVOLUTION / FIXED WINDOW",
    cue: "Hear dense convolved matter repeatedly fracture into pitched swarms, rotating rhythms, and inside-out phrase attacks.",
    summary: "sound becomes its own room",
    topology: "serial self-convolution",
    analysis: "bounded sparse impulse extraction",
    rewrite: "parent × parent · circular fold · fixed-length crop",
    wildness: "kernel swarms · rate spirals · rotating ancestral tails",
    depthLabel: "Convolution order",
    processKind: "CONVOLUTION",
  }),
  "phase-labyrinth": Object.freeze({
    title: "Phase Labyrinth",
    premise: "Phase chambers are struck by a recursive pulse field whose rhythm, pitch, filter, and phrase direction keep changing.",
    readout: "NESTED ALLPASS / TWISTED RETURN",
    cue: "Track attacks ricocheting through changing allpass routes while the source reverses, bends, swaps sides, and re-enters elsewhere.",
    summary: "enter phase · return through shorter routes",
    topology: "nested allpass call stack · twisted return",
    analysis: "group delay and inherited phase path",
    rewrite: "append one allpass chamber per inward call",
    wildness: "phase ricochet · polarity turns · layered clock collisions",
    depthLabel: "Labyrinth depth",
    processKind: "PHASE PATH",
  }),
});

const SOURCE_COPY = Object.freeze({
  noise: Object.freeze({
    readout: "PINK NOISE FIELD",
    note: "A repeatable pink-noise field exposes filters, phase cancellation, and spectral motion without suggesting a melody.",
  }),
  impulse: Object.freeze({
    readout: "SPARSE IMPULSE FIELD",
    note: "Clicks and micro-bursts make each delay, convolution tail, filter split, and phase smear easy to locate in time.",
  }),
  mic: Object.freeze({
    readout: "MICROPHONE CAPTURE",
    note: "A finite four-second capture becomes the seed. It is never live-monitored, and the microphone closes immediately.",
  }),
  file: Object.freeze({
    readout: "LOCAL AUDIO BUFFER",
    note: "The first four seconds are decoded and processed locally in this browser. The file is never uploaded.",
  }),
});

const settings = Object.fromEntries(RECURSION_STUDIES.map((study) => [
  study.id,
  {
    depth: study.defaults.depth,
    pace: study.defaults.pace,
    transform: study.defaults.transform,
    intensity: study.defaults.intensity,
  },
]));

const state = {
  studyId: "ouroboros-tape",
  source: "noise",
  geometryView: "orbit",
  level: 0.42,
  accumulate: true,
  playing: false,
  stepIndex: -1,
  steppedMoment: null,
  preparing: false,
  captureProgress: 0,
};

let plan = buildCurrentPlan();
let transportStart = 0;
let nextMomentIndex = 0;
let scheduledFrame = 0;
let cssWidth = 1;
let cssHeight = 1;
let pixelRatio = 1;
let lastRailSignature = "";
let lastAnnouncement = "";
let lastReducedPaint = -Infinity;
let restartNonce = 0;
const spectrumCache = new WeakMap();

function clamp(value, minimum, maximum) {
  return Math.min(maximum, Math.max(minimum, Number(value) || 0));
}

function currentStudy() {
  return studyById.get(state.studyId);
}

function currentUi() {
  return STUDY_UI[state.studyId];
}

function currentSettings() {
  return settings[state.studyId];
}

function formatClock(seconds) {
  const value = Math.max(0, Number(seconds) || 0);
  return `${Math.floor(value / 60)}:${String(Math.floor(value % 60)).padStart(2, "0")}`;
}

function buildCurrentPlan() {
  const values = settings[state.studyId];
  return buildRecursionPlan(state.studyId, {
    ...values,
    source: state.source,
  });
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
    globalThis.devicePixelRatio || 1,
    2,
    Math.sqrt(2_700_000 / Math.max(1, cssWidth * cssHeight)),
  ));
  canvas.width = Math.round(cssWidth * pixelRatio);
  canvas.height = Math.round(cssHeight * pixelRatio);
  scheduleFrame();
}

new ResizeObserver(resizeCanvas).observe(stageWrap);
resizeCanvas();

function sourceAvailable() {
  return audio.hasSeed(state.source);
}

function paintSource() {
  const copy = SOURCE_COPY[state.source];
  const sourceLabel = audio.seedLabel(state.source);
  $("sourceReadout").textContent = state.source === "noise" || state.source === "impulse"
    ? copy.readout
    : sourceAvailable()
    ? sourceLabel.toUpperCase()
    : copy.readout;
  $("seedNote").textContent = copy.note;
  $("fileInputLabel").hidden = state.source !== "file";
  $("captureButton").hidden = state.source !== "mic";
  for (const button of $("sourceButtons").querySelectorAll("[data-source]")) {
    setPressed(button, button.dataset.source === state.source);
  }
}

function pressureDescription(value) {
  if (value < 0.32) return "traceable";
  if (value < 0.62) return "building";
  if (value < 0.84) return "dense";
  return "event horizon";
}

function paintGeometryViews() {
  const views = {
    orbit: $("geometryOrbit"),
    stack: $("geometryStack"),
    causality: $("geometryCausality"),
  };
  for (const [view, button] of Object.entries(views)) {
    setPressed(button, view === state.geometryView);
  }
}

function paintStudyControls() {
  const study = currentStudy();
  const ui = currentUi();
  const values = currentSettings();
  const index = studyIndexById.get(state.studyId) ?? 0;
  $("stageIndex").textContent = `SYSTEM ${String(index + 1).padStart(2, "0")} / 06`;
  $("stageTitle").textContent = ui.title;
  $("stagePremise").textContent = ui.premise;
  $("studyCount").textContent = `${String(index + 1).padStart(2, "0")} / 06`;
  $("studySelect").value = state.studyId;
  $("listenCue").textContent = ui.cue;
  $("howSummary").textContent = ui.summary;
  $("howSequence").textContent = `${study.copy.sequence} Inside every generation, phrase bends timbre, timbre bends pitch, pitch fractures rhythm, and rhythm chooses the next phrase region.`;
  $("recursionMethod").textContent = ui.topology;
  $("analysisMethod").textContent = ui.analysis;
  $("parameterMethod").textContent = ui.rewrite;
  $("effectsMethod").textContent = ui.wildness;
  $("depthLabel").textContent = ui.depthLabel;
  $("processKind").textContent = ui.processKind;

  const depthDefinition = study.parameters.depth;
  $("depth").min = String(depthDefinition.min);
  $("depth").max = String(depthDefinition.max);
  $("depth").step = String(depthDefinition.step);
  $("depth").value = String(values.depth);
  $("depthOut").textContent = depthDefinition.format(values.depth);

  const paceDefinition = study.parameters.pace;
  $("pace").min = String(paceDefinition.min);
  $("pace").max = String(paceDefinition.max);
  $("pace").step = String(paceDefinition.step);
  $("pace").value = String(values.pace);
  $("paceOut").textContent = `${values.pace.toFixed(2)} seconds`;

  const transformDefinition = study.parameters.transform;
  $("transformLabel").textContent = transformDefinition.label;
  $("transform").min = String(transformDefinition.min);
  $("transform").max = String(transformDefinition.max);
  $("transform").step = String(transformDefinition.step);
  $("transform").value = String(values.transform);
  $("transformOut").textContent = transformDefinition.format(values.transform);

  const intensityDefinition = study.parameters.intensity;
  $("intensity").min = String(intensityDefinition.min);
  $("intensity").max = String(intensityDefinition.max);
  $("intensity").step = String(intensityDefinition.step);
  $("intensity").value = String(values.intensity);
  $("intensityOut").textContent = `${Math.round(values.intensity * 100)}% · ${pressureDescription(values.intensity)}`;

  for (const button of $("studyButtons").querySelectorAll("[data-study]")) {
    const selected = button.dataset.study === state.studyId;
    button.setAttribute("aria-selected", String(selected));
    button.tabIndex = selected ? 0 : -1;
  }
  setPressed($("accumulateButton"), state.accumulate);
  $("accumulateButton").querySelector("b").textContent = state.accumulate ? "Ancestors remain" : "Current generation only";
  $("accumulateButton").querySelector("small").textContent = state.accumulate
    ? "generations accumulate"
    : "solo the active lineage";
  paintSource();
  paintGeometryViews();
  paintReadout(null);
}

function updatePlan({ preserveStep = false } = {}) {
  plan = buildCurrentPlan();
  if (!preserveStep) {
    state.stepIndex = -1;
    state.steppedMoment = null;
  }
  lastRailSignature = "";
  paintTimeline(0, null);
  scheduleFrame();
}

async function prepareCurrent() {
  state.preparing = true;
  $("audioButton").disabled = true;
  $("listenButton").disabled = true;
  $("listenHint").textContent = state.studyId === "spectral-mobius"
    ? "folding the time-frequency sheet"
    : "building finite generations";
  try {
    await audio.prepare(state.studyId, currentSettings(), state.source);
    $("audioError").hidden = true;
    return true;
  } catch (error) {
    $("audioError").textContent = error instanceof Error ? error.message : "This system could not prepare its seed.";
    $("audioError").hidden = false;
    return false;
  } finally {
    state.preparing = false;
    $("audioButton").disabled = false;
    $("listenButton").disabled = false;
    $("listenHint").textContent = state.playing
      ? "the finite lineage is unfolding"
      : "start with the unprocessed seed";
  }
}

function setPlaying(playing) {
  state.playing = Boolean(playing);
  setPressed($("audioButton"), state.playing);
  setPressed($("listenButton"), state.playing);
  $("audioState").textContent = state.playing ? "descending" : "off";
  $("listenLabel").textContent = state.playing ? "Cut" : "Descend";
  $("listenHint").textContent = state.playing
    ? "the finite lineage is unfolding"
    : "start with the unprocessed seed";
  if (!state.playing) audio.stopSession();
  paintReadout(currentTransportState().moment);
  scheduleFrame();
}

function restartTransport() {
  if (!audio.context) return;
  audio.beginSession();
  transportStart = audio.context.currentTime + 0.08;
  nextMomentIndex = 0;
  state.stepIndex = -1;
  state.steppedMoment = null;
  lastAnnouncement = "";
}

async function togglePlayback() {
  if (state.playing) {
    setPlaying(false);
    return;
  }
  const ready = await prepareCurrent();
  if (!ready) return;
  restartTransport();
  setPlaying(true);
}

function lineageMoments(moment) {
  if (!state.accumulate || !moment || moment.kind === "unwind") return [moment];
  const available = plan.moments.filter((candidate) => (
    candidate.at <= moment.at
    && candidate.kind !== "unwind"
    && candidate.depth <= moment.depth
  ));
  const byDepth = new Map();
  for (const candidate of available) byDepth.set(candidate.depth, candidate);
  return [...byDepth.values()];
}

function lineagePhaseOffset(candidate, activeMoment, lineageIndex) {
  if (candidate === activeMoment) return 0;
  const age = Math.max(0, activeMoment.depth - candidate.depth);
  return (age * 0.173 + lineageIndex * 0.071) * candidate.duration;
}

function scheduleSemanticMoment(moment, when) {
  const lineage = lineageMoments(moment);
  const powerScale = 1 / Math.sqrt(Math.max(1, lineage.length));
  for (let index = 0; index < lineage.length; index += 1) {
    const candidate = lineage[index];
    const activeScale = candidate === moment ? 1 : 0.7;
    audio.scheduleMoment(
      state.studyId,
      candidate,
      when,
      powerScale * activeScale,
      {
        pulseLimit: candidate === moment ? 96 : 20,
        phaseOffset: lineagePhaseOffset(candidate, moment, index),
      },
    );
  }
}

function scheduleTransport(now) {
  if (!state.playing || !audio.context || !plan.moments.length) return;
  const duration = Math.max(1, plan.duration);
  while (transportStart + duration < now - 0.05) {
    transportStart += duration;
    nextMomentIndex = 0;
  }
  let guard = 0;
  while (guard < 128) {
    guard += 1;
    if (nextMomentIndex >= plan.moments.length) {
      transportStart += duration;
      nextMomentIndex = 0;
    }
    const moment = plan.moments[nextMomentIndex];
    const when = transportStart + moment.at;
    if (when > now + LOOKAHEAD_SECONDS) break;
    if (when >= now - 0.07) scheduleSemanticMoment(moment, when);
    nextMomentIndex += 1;
  }
}

async function stepForward() {
  if (state.playing) setPlaying(false);
  const ready = await prepareCurrent();
  if (!ready || !plan.moments.length) return;
  audio.beginSession();
  state.stepIndex = (state.stepIndex + 1) % plan.moments.length;
  state.steppedMoment = plan.moments[state.stepIndex];
  scheduleSemanticMoment(state.steppedMoment, audio.context.currentTime + 0.05);
  announce(state.steppedMoment);
  scheduleFrame();
}

function restartStudy() {
  if (state.playing) restartTransport();
  else {
    audio.stopSession();
    state.stepIndex = -1;
    state.steppedMoment = null;
    paintTimeline(0, null);
  }
  scheduleFrame();
}

function queuePreparedRestart() {
  const nonce = ++restartNonce;
  if (!state.playing) return;
  // Keep the current finite lineage audible while expensive generation
  // buffers are rebuilt. prepare() constructs its replacement off to the
  // side, and restartTransport() performs the session handoff only once the
  // newest requested parameter state is ready.
  globalThis.setTimeout?.(async () => {
    if (nonce !== restartNonce || !state.playing) return;
    const ready = await prepareCurrent();
    if (ready && nonce === restartNonce && state.playing) restartTransport();
  }, 120);
}

async function selectStudy(id) {
  if (!studyById.has(id) || id === state.studyId) return;
  const wasPlaying = state.playing;
  audio.stopSession();
  state.studyId = id;
  lastAnnouncement = "";
  lastRailSignature = "";
  paintStudyControls();
  updatePlan();
  audio.invalidate();
  if (wasPlaying) {
    const ready = await prepareCurrent();
    if (ready) restartTransport();
  }
}

function selectSource(source) {
  if (!SOURCE_COPY[source] || source === state.source) return;
  state.source = source;
  paintSource();
  updatePlan();
  audio.invalidate();
  if (state.playing) {
    if (!sourceAvailable()) setPlaying(false);
    else queuePreparedRestart();
  }
}

function momentAtTime(elapsed) {
  let active = null;
  for (const moment of plan.moments) {
    if (moment.at > elapsed + 1e-6) break;
    active = moment;
  }
  return active;
}

function currentTransportState() {
  if (!state.playing || !audio.context) {
    const moment = state.steppedMoment;
    return { elapsed: moment?.at ?? 0, moment, progress: moment ? 0.5 : 0 };
  }
  const duration = Math.max(1, plan.duration);
  const raw = audio.context.currentTime - transportStart;
  const elapsed = raw < 0 ? 0 : ((raw % duration) + duration) % duration;
  const moment = momentAtTime(elapsed);
  const span = Math.max(0.1, moment?.duration ?? currentSettings().pace);
  const progress = moment ? clamp((elapsed - moment.at) / span, 0, 1) : 0;
  return { elapsed, moment, progress };
}

function announce(moment) {
  if (!moment) return;
  const signature = `${state.studyId}:${moment.at}:${moment.kind}:${moment.depth}`;
  if (signature === lastAnnouncement) return;
  lastAnnouncement = signature;
  $("liveStatus").textContent = `${moment.label}. ${loadDescription(moment)}. Output power normalized.`;
}

function loadDescription(moment) {
  const depth = Math.max(0, moment?.depth ?? 0);
  if (state.studyId === "ouroboros-tape") return depth ? `generation ${depth} consumes generation ${depth - 1}` : "dry seed";
  if (state.studyId === "spectral-mobius") return `${depth} recursive spectral folds`;
  if (state.studyId === "filter-hydra") return `${2 ** depth} filter heads`;
  if (state.studyId === "cantor-delay") return `${2 ** depth} delay nodes, ${2 ** (depth + 1) - 1} total ancestors`;
  if (state.studyId === "convolution-maw") return `convolution order ${2 ** depth}`;
  if (moment?.kind === "unwind") return `${depth} allpass chambers remain`;
  return `${depth} nested allpass chambers`;
}

function paintReadout(moment) {
  const depth = Math.max(0, moment?.depth ?? 0);
  const direction = moment?.kind === "unwind" ? "UNWIND" : `G${depth}`;
  const motion = moment?.motion;
  const motionReadout = motion
    ? `${motion.pulses.length} PULSES · KLEIN ${motion.seam.orientation < 0 ? "INSIDE-OUT" : "OUTSIDE-IN"}`
    : "4 COUPLED CLOCKS";
  $("stageReadout").textContent = `${currentUi().readout} · ${state.geometryView.toUpperCase()} · ${direction} · ${motionReadout} · ${state.playing ? loadDescription(moment).toUpperCase() : "AUDIO OFF"}`;
}

function paintTimeline(elapsed, moment) {
  const duration = Math.max(1, plan.duration);
  $("timelineProgress").style.width = `${(clamp(elapsed / duration, 0, 1) * 100).toFixed(2)}%`;
  $("timelineMoment").textContent = moment?.label ?? "seed ready";
  $("timelineTime").textContent = `${formatClock(elapsed)} / ${formatClock(duration)}`;
}

function paintRail(moment) {
  const maximum = currentSettings().depth;
  const active = clamp(moment?.depth ?? 0, 0, maximum);
  const returning = moment?.kind === "unwind";
  const signature = `${maximum}:${active}:${returning}:${state.playing}`;
  if (signature === lastRailSignature) return;
  lastRailSignature = signature;
  const cells = [];
  for (let generation = 0; generation <= maximum; generation += 1) {
    let className = "";
    if (generation === active) className = returning ? "is-returning" : "is-active";
    else if (state.accumulate && generation < active) className = "is-waiting";
    cells.push(`<i class="${className}">G${generation}</i>`);
  }
  $("depthRail").innerHTML = cells.join("");
}

function canvasSetup() {
  drawing.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
  drawing.clearRect(0, 0, cssWidth, cssHeight);
  drawing.lineCap = "round";
  drawing.lineJoin = "round";
}

function palette() {
  return {
    line: "rgba(214, 232, 226, 0.11)",
    faint: "rgba(119, 131, 126, 0.36)",
    muted: "rgba(119, 131, 126, 0.76)",
    ink: "#dbe4e0",
    teal: "#70ead8",
    blue: "#7db4ff",
    violet: "#c79bff",
    brass: "#e8c46b",
    hot: "#ff826f",
    white: "#fff3d6",
  };
}

function visualBounds() {
  const compact = cssHeight < 430;
  return {
    left: Math.max(24, cssWidth * (compact ? 0.08 : 0.12)),
    right: cssWidth - Math.max(24, cssWidth * 0.08),
    top: cssHeight * (compact ? 0.32 : 0.29),
    bottom: cssHeight * (compact ? 0.69 : 0.73),
  };
}

function lineColour(depth, maximum, alpha = 1) {
  const ratio = maximum ? depth / maximum : 0;
  const red = Math.round(112 + (199 - 112) * ratio);
  const green = Math.round(234 + (155 - 234) * ratio);
  const blue = Math.round(216 + (255 - 216) * ratio);
  return `rgba(${red}, ${green}, ${blue}, ${alpha})`;
}

function drawNode(x, y, radius, color, active = false, diamond = false) {
  drawing.save();
  drawing.strokeStyle = color;
  drawing.fillStyle = active ? color : "rgba(5, 6, 8, 0.86)";
  drawing.lineWidth = active ? 1.6 : 1;
  if (active) {
    drawing.shadowColor = color;
    drawing.shadowBlur = 11;
  }
  drawing.beginPath();
  if (diamond) {
    drawing.moveTo(x, y - radius);
    drawing.lineTo(x + radius, y);
    drawing.lineTo(x, y + radius);
    drawing.lineTo(x - radius, y);
    drawing.closePath();
  } else {
    drawing.arc(x, y, radius, 0, TAU);
  }
  drawing.fill();
  drawing.stroke();
  drawing.restore();
}

function drawLabel(text, x, y, color, align = "center", size = 8) {
  drawing.save();
  drawing.fillStyle = color;
  drawing.font = `${size}px ui-monospace, "SF Mono", Menlo, monospace`;
  drawing.textAlign = align;
  drawing.textBaseline = "middle";
  drawing.fillText(text, x, y);
  drawing.restore();
}

function waveformPoint(channel, normalized) {
  if (!channel?.length) return 0;
  const position = clamp(normalized, 0, 1) * (channel.length - 1);
  const index = Math.floor(position);
  return channel[index] ?? 0;
}

function drawOuroboros(moment, progress) {
  const colors = palette();
  const bounds = visualBounds();
  const maximum = currentSettings().depth;
  const active = clamp(moment?.depth ?? 0, 0, maximum);
  const centerX = (bounds.left + bounds.right) / 2;
  const centerY = (bounds.top + bounds.bottom) / 2;
  const maximumRadius = Math.min((bounds.right - bounds.left) * 0.38, (bounds.bottom - bounds.top) * 0.76);

  for (let generation = 0; generation <= maximum; generation += 1) {
    const channels = audio.visualGeneration(generation);
    const channel = channels?.[0];
    const radius = maximumRadius * (1 - generation / (maximum + 2) * 0.68);
    const isActive = generation === active;
    drawing.save();
    drawing.strokeStyle = isActive ? lineColour(generation, maximum) : colors.line;
    drawing.lineWidth = isActive ? 1.5 : 0.75;
    if (isActive) {
      drawing.shadowColor = colors.violet;
      drawing.shadowBlur = 9;
    }
    drawing.beginPath();
    const points = 144;
    for (let index = 0; index <= points; index += 1) {
      const phase = index / points;
      const theta = phase * TAU;
      const sample = waveformPoint(channel, phase);
      const localRadius = radius + sample * (isActive ? 12 : 5);
      const x = centerX + Math.cos(theta) * localRadius;
      const y = centerY + Math.sin(theta) * localRadius * 0.55;
      if (!index) drawing.moveTo(x, y);
      else drawing.lineTo(x, y);
    }
    drawing.stroke();
    drawing.restore();
  }

  const biteAngle = -Math.PI / 2 + progress * TAU;
  const activeRadius = maximumRadius * (1 - active / (maximum + 2) * 0.68);
  drawNode(
    centerX + Math.cos(biteAngle) * activeRadius,
    centerY + Math.sin(biteAngle) * activeRadius * 0.55,
    6,
    colors.hot,
    true,
    active % 2 === 1,
  );
  drawLabel("TAIL → HEAD", centerX, centerY, colors.muted);
}

function spectrogram(channel) {
  if (!channel?.length) return null;
  if (spectrumCache.has(channel)) return spectrumCache.get(channel);
  const columns = 48;
  const rows = 28;
  const fftSize = 128;
  const matrix = new Float32Array(columns * rows);
  let maximum = 1e-9;
  for (let column = 0; column < columns; column += 1) {
    const center = Math.floor(column / Math.max(1, columns - 1) * Math.max(0, channel.length - fftSize));
    for (let row = 0; row < rows; row += 1) {
      const bin = Math.max(1, Math.round((Math.exp(row / (rows - 1) * Math.log(fftSize / 2)) - 1)));
      let real = 0;
      let imaginary = 0;
      for (let index = 0; index < fftSize; index += 1) {
        const sample = channel[center + index] ?? 0;
        const window = Math.sin(Math.PI * index / fftSize) ** 2;
        const angle = TAU * bin * index / fftSize;
        real += sample * window * Math.cos(angle);
        imaginary -= sample * window * Math.sin(angle);
      }
      const magnitude = Math.log1p(Math.hypot(real, imaginary));
      matrix[(rows - 1 - row) * columns + column] = magnitude;
      maximum = Math.max(maximum, magnitude);
    }
  }
  for (let index = 0; index < matrix.length; index += 1) matrix[index] /= maximum;
  const result = { matrix, columns, rows };
  spectrumCache.set(channel, result);
  return result;
}

function drawSpectralMobius(moment, progress) {
  const colors = palette();
  const bounds = visualBounds();
  const depth = clamp(moment?.depth ?? 0, 0, currentSettings().depth);
  const data = spectrogram(audio.visualGeneration(depth)?.[0]);
  if (!data) return;
  const width = bounds.right - bounds.left;
  const height = bounds.bottom - bounds.top;
  const cellWidth = width / data.columns;
  const cellHeight = height / data.rows;
  const pressure = currentSettings().intensity;

  for (let row = 0; row < data.rows; row += 1) {
    for (let column = 0; column < data.columns; column += 1) {
      const magnitude = data.matrix[row * data.columns + column];
      if (magnitude < 0.025) continue;
      const hueRatio = row / data.rows;
      drawing.fillStyle = hueRatio > 0.52
        ? `rgba(199, 155, 255, ${magnitude * (0.36 + pressure * 0.55)})`
        : `rgba(112, 234, 216, ${magnitude * (0.3 + pressure * 0.5)})`;
      drawing.fillRect(
        bounds.left + column * cellWidth,
        bounds.top + row * cellHeight,
        cellWidth + 0.4,
        cellHeight + 0.4,
      );
    }
  }

  const transform = currentSettings().transform;
  drawing.save();
  drawing.strokeStyle = colors.white;
  drawing.lineWidth = 1.2;
  drawing.shadowColor = colors.violet;
  drawing.shadowBlur = 8;
  drawing.beginPath();
  const seamX = bounds.left + width * (0.5 + Math.sin(progress * Math.PI) * 0.08);
  for (let index = 0; index <= 60; index += 1) {
    const source = index / 60;
    const folded = mobiusFrequencyMap(source, transform);
    const x = seamX + (folded - source) * width * 0.24;
    const y = bounds.bottom - source * height;
    if (!index) drawing.moveTo(x, y);
    else drawing.lineTo(x, y);
  }
  drawing.stroke();
  drawing.restore();
  drawLabel(`FFT 1024 · FOLD ${transform.toFixed(2)}`, bounds.right, bounds.top - 12, colors.muted, "right");
}

function drawFilterHydra(moment) {
  const colors = palette();
  const bounds = visualBounds();
  const activeDepth = clamp(moment?.depth ?? 0, 0, currentSettings().depth);
  const maximum = currentSettings().depth;
  const width = bounds.right - bounds.left;
  const height = bounds.bottom - bounds.top;
  const xStep = width / Math.max(1, maximum);

  for (let depth = 0; depth <= maximum; depth += 1) {
    const count = 2 ** depth;
    for (let index = 0; index < count; index += 1) {
      const x = bounds.left + depth * xStep;
      const y = bounds.top + (index + 0.5) / count * height;
      if (depth < maximum) {
        const childCount = count * 2;
        for (let branch = 0; branch < 2; branch += 1) {
          const childY = bounds.top + (index * 2 + branch + 0.5) / childCount * height;
          drawing.strokeStyle = depth < activeDepth ? lineColour(depth + 1, maximum, 0.54) : colors.line;
          drawing.lineWidth = 0.8;
          drawing.beginPath();
          drawing.moveTo(x, y);
          drawing.lineTo(x + xStep, childY);
          drawing.stroke();
        }
      }
      const active = depth === activeDepth;
      const nodeHeight = Math.max(2, height / count * 0.55);
      drawing.fillStyle = active ? lineColour(depth, maximum, 0.72) : colors.faint;
      drawing.fillRect(x - (active ? 4 : 2), y - nodeHeight / 2, active ? 8 : 4, nodeHeight);
    }
  }
  drawLabel(`${2 ** activeDepth} HEADS`, bounds.right, bounds.top - 12, colors.muted, "right");
}

function cantorSegments(depth, ratio) {
  let segments = [[0, 1]];
  for (let level = 0; level < depth; level += 1) {
    const next = [];
    for (const [start, end] of segments) {
      const width = end - start;
      next.push([start, start + width * ratio], [end - width * ratio, end]);
    }
    segments = next;
  }
  return segments;
}

function drawCantorDelay(moment, progress) {
  const colors = palette();
  const bounds = visualBounds();
  const maximum = currentSettings().depth;
  const activeDepth = clamp(moment?.depth ?? 0, 0, maximum);
  const ratio = currentSettings().transform;
  const rowHeight = (bounds.bottom - bounds.top) / Math.max(1, maximum + 1);

  for (let depth = 0; depth <= maximum; depth += 1) {
    const y = bounds.top + (depth + 0.5) * rowHeight;
    const active = depth === activeDepth;
    for (const [start, end] of cantorSegments(depth, ratio)) {
      const x = bounds.left + start * (bounds.right - bounds.left);
      const width = Math.max(1, (end - start) * (bounds.right - bounds.left));
      drawing.fillStyle = active ? lineColour(depth, maximum, 0.76) : colors.faint;
      drawing.fillRect(x, y - (active ? 3 : 1.5), width, active ? 6 : 3);
      if (active && !reducedMotion) {
        const dropX = x + width * progress;
        drawing.strokeStyle = lineColour(depth, maximum, 0.38);
        drawing.beginPath();
        drawing.moveTo(dropX, y + 5);
        drawing.lineTo(dropX, Math.min(bounds.bottom, y + rowHeight * 0.65));
        drawing.stroke();
      }
    }
    drawLabel(`D${depth}`, bounds.left - 10, y, active ? colors.teal : colors.muted, "right");
  }
  drawLabel(`${2 ** activeDepth} FRONTS · NO FEEDBACK`, bounds.right, bounds.top - 12, colors.muted, "right");
}

function drawConvolutionMaw(moment, progress) {
  const colors = palette();
  const bounds = visualBounds();
  const depth = clamp(moment?.depth ?? 0, 0, currentSettings().depth);
  const size = Math.min(bounds.bottom - bounds.top, (bounds.right - bounds.left) * 0.5);
  const left = bounds.left;
  const top = bounds.top;
  const cells = Math.min(18, 5 + depth * 3);
  const cell = size / cells;

  drawing.save();
  drawing.strokeStyle = colors.line;
  drawing.lineWidth = 0.6;
  for (let index = 0; index <= cells; index += 1) {
    drawing.beginPath();
    drawing.moveTo(left + index * cell, top);
    drawing.lineTo(left + index * cell, top + size);
    drawing.stroke();
    drawing.beginPath();
    drawing.moveTo(left, top + index * cell);
    drawing.lineTo(left + size, top + index * cell);
    drawing.stroke();
  }
  const diagonals = Math.min(cells * 2 - 1, 3 + depth * 4);
  for (let diagonal = 0; diagonal < diagonals; diagonal += 1) {
    drawing.strokeStyle = lineColour(depth, currentSettings().depth, 0.18 + diagonal / diagonals * 0.55);
    drawing.lineWidth = 1 + currentSettings().intensity * 0.7;
    drawing.beginPath();
    const startX = diagonal < cells ? left + diagonal * cell : left + size;
    const startY = diagonal < cells ? top : top + (diagonal - cells + 1) * cell;
    drawing.moveTo(startX, startY);
    drawing.lineTo(
      Math.max(left, startX - size),
      Math.min(top + size, startY + size),
    );
    drawing.stroke();
  }
  drawing.restore();

  const channel = audio.visualGeneration(depth)?.[0];
  const waveformLeft = left + size + Math.max(24, (bounds.right - bounds.left) * 0.06);
  const waveformWidth = bounds.right - waveformLeft;
  const centerY = (bounds.top + bounds.bottom) / 2;
  drawing.strokeStyle = colors.violet;
  drawing.lineWidth = 1.4;
  drawing.beginPath();
  const points = 100;
  for (let index = 0; index <= points; index += 1) {
    const x = waveformLeft + index / points * waveformWidth;
    const sample = waveformPoint(channel, index / points);
    const y = centerY + sample * (bounds.bottom - bounds.top) * 0.38;
    if (!index) drawing.moveTo(x, y);
    else drawing.lineTo(x, y);
  }
  drawing.stroke();
  drawNode(waveformLeft + waveformWidth * progress, centerY, 5, colors.hot, true, true);
  drawLabel(`ORDER ${2 ** depth}`, bounds.right, bounds.top - 12, colors.muted, "right");
}

function bandProfile(channel, bands = 42) {
  const spectrum = spectrogram(channel);
  if (!spectrum) return new Float32Array(bands);
  const profile = new Float32Array(bands);
  for (let band = 0; band < bands; band += 1) {
    const row = Math.min(spectrum.rows - 1, Math.floor(band / bands * spectrum.rows));
    let sum = 0;
    for (let column = 0; column < spectrum.columns; column += 1) {
      sum += spectrum.matrix[row * spectrum.columns + column];
    }
    profile[band] = sum / spectrum.columns;
  }
  return profile;
}

function drawPhaseLabyrinth(moment, progress) {
  const colors = palette();
  const bounds = visualBounds();
  const depth = clamp(moment?.depth ?? 0, 0, currentSettings().depth);
  const returning = moment?.kind === "unwind";
  const profile = bandProfile(audio.visualGeneration(0)?.[0]);
  const width = bounds.right - bounds.left;
  const height = bounds.bottom - bounds.top;
  const centerY = (bounds.top + bounds.bottom) / 2;

  drawing.save();
  drawing.strokeStyle = colors.faint;
  drawing.fillStyle = "rgba(112, 234, 216, 0.055)";
  drawing.beginPath();
  for (let index = 0; index < profile.length; index += 1) {
    const x = bounds.left + index / (profile.length - 1) * width;
    const y = centerY - profile[index] * height * 0.43;
    if (!index) drawing.moveTo(x, y);
    else drawing.lineTo(x, y);
  }
  for (let index = profile.length - 1; index >= 0; index -= 1) {
    const x = bounds.left + index / (profile.length - 1) * width;
    const y = centerY + profile[index] * height * 0.43;
    drawing.lineTo(x, y);
  }
  drawing.closePath();
  drawing.fill();
  drawing.stroke();
  drawing.restore();

  const chambers = Math.max(1, currentSettings().depth);
  for (let stage = 1; stage <= chambers; stage += 1) {
    const active = stage <= depth;
    const x = bounds.left + stage / (chambers + 1) * width;
    const radius = 9 + stage * 1.6;
    drawing.save();
    drawing.strokeStyle = active
      ? returning ? colors.brass : lineColour(stage, chambers, 0.85)
      : colors.line;
    drawing.lineWidth = active ? 1.4 : 0.8;
    if (!active) drawing.setLineDash([2, 5]);
    drawing.beginPath();
    const turns = 2 + stage * 0.4;
    const points = 70;
    for (let index = 0; index <= points; index += 1) {
      const phase = index / points;
      const theta = phase * TAU * turns * (returning ? -1 : 1) + progress * TAU;
      const localRadius = radius * phase;
      const px = x + Math.cos(theta) * localRadius;
      const py = centerY + Math.sin(theta) * localRadius;
      if (!index) drawing.moveTo(px, py);
      else drawing.lineTo(px, py);
    }
    drawing.stroke();
    drawing.restore();
    drawLabel(`${stage}`, x, centerY + radius + 13, active ? (returning ? colors.brass : colors.violet) : colors.muted);
  }
  drawLabel(returning ? "SHORTER RETURN ROUTE" : `${depth} PHASE CHAMBERS`, bounds.right, bounds.top - 12, colors.muted, "right");
}

function drawMotionTopology(moment, progress) {
  const motion = moment?.motion;
  if (!motion?.pulses?.length) return;
  const colors = palette();
  const dimensions = [
    ["timbre", "TMB", colors.teal],
    ["pitch", "PCH", colors.violet],
    ["rhythm", "RHY", colors.brass],
    ["phrase", "PHR", colors.hot],
  ];
  const left = Math.max(28, cssWidth * 0.11);
  const right = cssWidth - Math.max(28, cssWidth * 0.08);
  const width = right - left;
  const centerY = cssHeight * 0.84;
  const orientation = motion.seam.orientation;

  drawing.save();
  drawing.strokeStyle = orientation < 0 ? "rgba(255, 130, 111, 0.34)" : "rgba(112, 234, 216, 0.3)";
  drawing.lineWidth = 0.8;
  drawing.beginPath();
  for (let index = 0; index <= 80; index += 1) {
    const position = index / 80;
    const x = left + position * width;
    const twist = Math.sin((position * 2 + progress) * TAU) * 7 * orientation;
    const y = centerY + twist;
    if (!index) drawing.moveTo(x, y);
    else drawing.lineTo(x, y);
  }
  drawing.stroke();

  const duration = Math.max(0.08, moment.duration);
  for (const pulse of motion.pulses) {
    const position = clamp(pulse.offset / duration, 0, 1);
    const distance = Math.abs(position - progress);
    const wrappedDistance = Math.min(distance, 1 - distance);
    if (wrappedDistance > 0.075) continue;
    const x = left + position * width;
    const y = centerY + Math.sin((position * 2 + progress) * TAU) * 7 * orientation;
    drawing.fillStyle = pulse.polarity < 0 ? colors.hot : colors.white;
    const radius = wrappedDistance < 0.02 ? 2.4 : 1.2;
    drawing.beginPath();
    drawing.arc(x, y, radius, 0, TAU);
    drawing.fill();
  }

  for (let index = 0; index < dimensions.length; index += 1) {
    const [name, label, color] = dimensions[index];
    const definition = motion.clocks[name];
    const phase = definition.phase
      + definition.direction * definition.cycles * progress;
    const wrapped = phase - Math.floor(phase);
    const x = left + (index + 0.5) / dimensions.length * width;
    const radius = 10;
    drawing.strokeStyle = color;
    drawing.lineWidth = 0.9;
    drawing.beginPath();
    drawing.arc(x, centerY, radius, 0, TAU);
    drawing.stroke();
    drawing.beginPath();
    drawing.moveTo(x, centerY);
    drawing.lineTo(
      x + Math.cos(wrapped * TAU) * radius,
      centerY + Math.sin(wrapped * TAU) * radius,
    );
    drawing.stroke();
    drawLabel(label, x, centerY + 19, color, "center", 7);
  }
  drawing.restore();

  drawLabel(
    `${motion.pulses.length} GRAINS · ${motion.seam.crossings} SEAM CROSSINGS`,
    right,
    centerY + 20,
    colors.muted,
    "right",
    7,
  );
}

function geometryColour(coordinate, alpha = 1) {
  const position = clamp(coordinate.spectrum, 0, 1);
  const low = [112, 234, 216];
  const middle = [199, 155, 255];
  const high = coordinate.orientation < 0 ? [255, 130, 111] : [232, 196, 107];
  const start = position < 0.5 ? low : middle;
  const end = position < 0.5 ? middle : high;
  const local = position < 0.5 ? position * 2 : (position - 0.5) * 2;
  const channels = start.map((value, index) => Math.round(
    value + (end[index] - value) * local,
  ));
  return `rgba(${channels[0]}, ${channels[1]}, ${channels[2]}, ${clamp(alpha, 0, 1)})`;
}

function geometryMoments(activeMoment) {
  const active = activeMoment ?? plan.moments[0];
  if (!active) return [];
  return lineageMoments(active).filter(Boolean).map((candidate, index) => {
    const available = candidate.motion?.pulses ?? [];
    const limit = candidate === active ? 96 : 20;
    const audiblePulses = available.length <= limit
      ? available
      : Array.from(
        { length: limit },
        (_, pulseIndex) => available[Math.floor(pulseIndex * available.length / limit)],
      );
    const phaseOffset = lineagePhaseOffset(candidate, active, index);
    const offsetSpan = Math.max(0.08, candidate.duration * 0.84);
    return {
      ...candidate,
      motion: {
        ...candidate.motion,
        pulses: audiblePulses.map((pulse) => ({
          ...pulse,
          offset: (
            (pulse.offset + phaseOffset) % offsetSpan + offsetSpan
          ) % offsetSpan,
        })),
      },
    };
  });
}

function geometryScene(activeMoment, progress, maxPoints) {
  const moments = geometryMoments(activeMoment);
  return geometryTrace(moments, {
    maxPoints,
    activeMomentIndex: moments.length - 1,
    progress,
  });
}

function projectionToCanvas(projected, bounds, {
  xScale = 0.48,
  yScale = 0.54,
  depthShift = 0.035,
} = {}) {
  const width = bounds.right - bounds.left;
  const height = bounds.bottom - bounds.top;
  return {
    x: (bounds.left + bounds.right) / 2 + projected.x * width * xScale,
    y: (bounds.top + bounds.bottom) / 2
      + projected.y * height * yScale
      - projected.z * height * depthShift,
    z: projected.z,
    scale: projected.scale,
    alpha: projected.alpha,
  };
}

function releaseCoordinate(coordinate) {
  const phraseTravel = coordinate.duration
    * coordinate.playbackRate
    * coordinate.timeDirection
    * 0.72;
  const source = coordinate.u + phraseTravel;
  return {
    ...coordinate,
    u: source - Math.floor(source),
    w: coordinate.releaseTime,
    time: coordinate.releaseTime,
    rhythm: coordinate.releaseTime,
    v: coordinate.spectrumRelease,
    spectrum: coordinate.spectrumRelease,
    pitch: coordinate.pitchRelease,
    pan: coordinate.panRelease,
    energy: coordinate.energy * 0.78,
    occupancy: coordinate.occupancy * 0.78,
  };
}

function drawGeometryLine(start, end, colour, width = 0.8) {
  drawing.strokeStyle = colour;
  drawing.lineWidth = width;
  drawing.beginPath();
  drawing.moveTo(start.x, start.y);
  drawing.lineTo(end.x, end.y);
  drawing.stroke();
}

function drawOrbitWireframe(bounds, activeMoment, progress, twist) {
  const depth = clamp(
    (activeMoment?.depth ?? 0) / Math.max(1, currentSettings().depth),
    0,
    1,
  );
  const orientation = activeMoment?.motion?.seam?.orientation ?? 1;
  const rotation = (reducedMotion ? 0 : progress * 0.62)
    + (activeMoment?.depth ?? 0) * 0.075 * orientation;
  const common = {
    depth,
    pitch: 0,
    pan: 0,
    energy: 0.14,
    orientation,
    polarity: 1,
  };

  drawing.save();
  drawing.strokeStyle = "rgba(214, 232, 226, 0.085)";
  drawing.lineWidth = 0.6;
  for (let minor = 0; minor < 9; minor += 1) {
    drawing.beginPath();
    for (let index = 0; index <= 52; index += 1) {
      const coordinate = {
        ...common,
        u: minor / 9,
        v: 0.48,
        w: index / 52,
      };
      const screen = projectionToCanvas(
        torusPoint(coordinate, { rotation, twist }),
        bounds,
      );
      if (!index) drawing.moveTo(screen.x, screen.y);
      else drawing.lineTo(screen.x, screen.y);
    }
    drawing.stroke();
  }
  for (let major = 0; major < 14; major += 1) {
    drawing.beginPath();
    for (let index = 0; index <= 30; index += 1) {
      const coordinate = {
        ...common,
        u: index / 30,
        v: 0.48,
        w: major / 14,
      };
      const screen = projectionToCanvas(
        torusPoint(coordinate, { rotation, twist }),
        bounds,
      );
      if (!index) drawing.moveTo(screen.x, screen.y);
      else drawing.lineTo(screen.x, screen.y);
    }
    drawing.stroke();
  }
  drawing.restore();
  return rotation;
}

function drawOrbitGeometry(activeMoment, progress) {
  const bounds = visualBounds();
  const trace = geometryScene(activeMoment, progress, state.accumulate ? 384 : 160);
  const coupling = activeMoment?.motion?.coupling ?? {};
  const couplingStrength = [
    coupling.timbreToPitch,
    coupling.pitchToRhythm,
    coupling.rhythmToPhrase,
    coupling.phraseToTimbre,
  ].reduce((total, value) => total + Math.abs(Number(value) || 0), 0) / 4;
  const twist = 0.66 + couplingStrength * 0.82;
  const rotation = drawOrbitWireframe(bounds, activeMoment, progress, twist);
  const trajectories = trace.points.map((coordinate) => {
    const attack = projectionToCanvas(
      torusPoint(coordinate, { rotation, twist }),
      bounds,
    );
    const release = projectionToCanvas(
      torusPoint(releaseCoordinate(coordinate), { rotation, twist }),
      bounds,
    );
    return { coordinate, attack, release };
  }).sort((left, right) => left.attack.z - right.attack.z);

  for (const { coordinate, attack, release } of trajectories) {
    const sounding = coordinate.sounding;
    const visited = coordinate.active;
    const alpha = sounding ? 0.96 : visited ? 0.5 : 0.18;
    drawGeometryLine(
      attack,
      release,
      geometryColour(coordinate, alpha),
      sounding ? 2.1 : visited ? 1.05 : 0.6,
    );
    drawing.save();
    drawing.fillStyle = geometryColour(coordinate, sounding ? 1 : 0.46);
    if (sounding) {
      drawing.shadowColor = geometryColour(coordinate, 1);
      drawing.shadowBlur = 13;
    }
    drawing.beginPath();
    drawing.arc(
      attack.x,
      attack.y,
      (sounding ? 4.2 : 1.3 + coordinate.energy * 1.5) * attack.scale,
      0,
      TAU,
    );
    drawing.fill();
    drawing.restore();
  }

  const colors = palette();
  drawLabel("RHYTHM / OUTPUT TIME → MAJOR ORBIT", bounds.left, bounds.bottom + 14, colors.muted, "left", 7);
  drawLabel("PHRASE τ ↻ · SPECTRUM / PITCH ↕ · POLARITY = ORIENTATION", bounds.right, bounds.bottom + 14, colors.muted, "right", 7);
}

function drawStackPlane(bounds, metaTime, active, progress) {
  const color = active ? "rgba(112, 234, 216, 0.22)" : "rgba(214, 232, 226, 0.065)";
  const base = {
    depth: metaTime,
    metaTime,
    delay: 0,
    pitch: 0,
    phrase: 0.5,
    pan: 0,
    energy: 0.1,
  };
  const corners = [
    { ...base, w: 0, v: 0 },
    { ...base, w: 1, v: 0 },
    { ...base, w: 1, v: 1 },
    { ...base, w: 0, v: 1 },
    { ...base, w: 0, v: 0 },
  ].map((coordinate) => projectionToCanvas(
    stackPoint(coordinate),
    bounds,
    { xScale: 0.45, yScale: 0.49, depthShift: 0.05 },
  ));
  drawing.strokeStyle = color;
  drawing.lineWidth = active ? 0.9 : 0.55;
  drawing.beginPath();
  corners.forEach((point, index) => {
    if (!index) drawing.moveTo(point.x, point.y);
    else drawing.lineTo(point.x, point.y);
  });
  drawing.stroke();

  if (active) {
    const playhead = [0, 1].map((spectrum) => projectionToCanvas(
      stackPoint({
        ...base,
        w: progress,
        v: spectrum,
      }),
      bounds,
      { xScale: 0.45, yScale: 0.49, depthShift: 0.05 },
    ));
    drawGeometryLine(playhead[0], playhead[1], "rgba(255, 243, 214, 0.52)", 1);
  }
}

function drawStackGeometry(activeMoment, progress) {
  const bounds = visualBounds();
  const moments = geometryMoments(activeMoment);
  const trace = geometryTrace(moments, {
    maxPoints: state.accumulate ? 512 : 192,
    activeMomentIndex: moments.length - 1,
    progress,
  });
  for (let index = 0; index < moments.length; index += 1) {
    drawStackPlane(
      bounds,
      moments.length > 1 ? index / (moments.length - 1) : 0,
      index === moments.length - 1,
      progress,
    );
  }

  const trajectories = trace.points.map((coordinate) => {
    const attack = projectionToCanvas(
      stackPoint(coordinate),
      bounds,
      { xScale: 0.45, yScale: 0.49, depthShift: 0.05 },
    );
    const release = projectionToCanvas(
      stackPoint(releaseCoordinate(coordinate)),
      bounds,
      { xScale: 0.45, yScale: 0.49, depthShift: 0.05 },
    );
    const scored = projectionToCanvas(
      stackPoint({ ...coordinate, w: coordinate.scoreTime }),
      bounds,
      { xScale: 0.45, yScale: 0.49, depthShift: 0.05 },
    );
    return { coordinate, attack, release, scored };
  }).sort((left, right) => left.attack.z - right.attack.z);

  for (const { coordinate, attack, release, scored } of trajectories) {
    if (coordinate.delay > 0.001) {
      drawing.save();
      drawing.setLineDash([2, 4]);
      drawGeometryLine(scored, attack, geometryColour(coordinate, 0.19), 0.55);
      drawing.restore();
    }
    const alpha = coordinate.sounding ? 1 : coordinate.active ? 0.55 : 0.2;
    drawGeometryLine(
      attack,
      release,
      geometryColour(coordinate, alpha),
      coordinate.sounding ? 2.2 : 0.7 + coordinate.energy * 0.75,
    );
    drawing.fillStyle = geometryColour(coordinate, alpha);
    drawing.beginPath();
    drawing.arc(attack.x, attack.y, coordinate.sounding ? 3.7 : 1.2, 0, TAU);
    drawing.fill();
  }

  const colors = palette();
  drawLabel("OUTPUT / RHYTHM TIME →", bounds.left, bounds.bottom + 14, colors.muted, "left", 7);
  drawLabel("↑ LOG SPECTRUM · RECURSIVE TIME = LAYER DEPTH", bounds.right, bounds.bottom + 14, colors.muted, "right", 7);
}

function normalizedGeometryPoint(point, bounds) {
  const width = bounds.right - bounds.left;
  const height = bounds.bottom - bounds.top;
  return {
    x: (bounds.left + bounds.right) / 2 + point.x * width * 0.48,
    y: (bounds.top + bounds.bottom) / 2
      + point.y * height * 0.52
      - point.z * height * 0.045,
    z: point.z,
    scale: point.scale,
    alpha: point.alpha,
  };
}

function drawCausalityGeometry(activeMoment, progress) {
  const bounds = visualBounds();
  const trace = geometryScene(activeMoment, progress, state.accumulate ? 224 : 128);
  const colors = palette();
  const rails = [
    [-0.92, "SOURCE / PHRASE τ", "left"],
    [0, "DSP ROUTE", "center"],
    [0.92, "OUTPUT / RHYTHM T", "right"],
  ];
  for (const [position] of rails) {
    const x = (bounds.left + bounds.right) / 2
      + position * (bounds.right - bounds.left) * 0.48;
    drawing.strokeStyle = "rgba(214, 232, 226, 0.1)";
    drawing.lineWidth = 0.7;
    drawing.beginPath();
    drawing.moveTo(x, bounds.top);
    drawing.lineTo(x, bounds.bottom);
    drawing.stroke();
  }

  const ordered = [...trace.points].sort((left, right) => (
    left.metaTime - right.metaTime || left.w - right.w
  ));
  for (const coordinate of ordered) {
    const curve = causalCurve([coordinate], { segments: 12 });
    drawing.save();
    if (coordinate.timeDirection < 0) drawing.setLineDash([3, 4]);
    drawing.strokeStyle = geometryColour(
      coordinate,
      coordinate.sounding ? 0.96 : coordinate.active ? 0.42 : 0.12,
    );
    drawing.lineWidth = coordinate.sounding ? 2 : 0.55 + coordinate.energy * 0.75;
    drawing.beginPath();
    curve.forEach((point, index) => {
      const screen = normalizedGeometryPoint(point, bounds);
      if (!index) drawing.moveTo(screen.x, screen.y);
      else drawing.lineTo(screen.x, screen.y);
    });
    drawing.stroke();
    drawing.restore();

    const sourcePoint = normalizedGeometryPoint(curve[0], bounds);
    const routePoint = normalizedGeometryPoint(
      curve[Math.floor(curve.length / 2)],
      bounds,
    );
    const outputPoint = normalizedGeometryPoint(curve.at(-1), bounds);
    drawing.fillStyle = geometryColour(coordinate, coordinate.sounding ? 1 : 0.46);
    for (const point of [sourcePoint, routePoint]) {
      drawing.beginPath();
      drawing.arc(point.x, point.y, coordinate.sounding ? 3.2 : 1.25, 0, TAU);
      drawing.fill();
    }
    drawing.save();
    drawing.strokeStyle = geometryColour(coordinate, coordinate.sounding ? 1 : 0.55);
    drawing.fillStyle = coordinate.channelSwap
      ? "rgba(5, 6, 8, 0.84)"
      : geometryColour(coordinate, coordinate.sounding ? 1 : 0.42);
    drawing.lineWidth = 0.9;
    drawing.beginPath();
    drawing.arc(
      outputPoint.x + coordinate.pan * 5,
      outputPoint.y,
      coordinate.sounding ? 3.8 : 1.7,
      0,
      TAU,
    );
    drawing.fill();
    drawing.stroke();
    drawing.restore();
  }

  for (const [position, label, align] of rails) {
    const x = (bounds.left + bounds.right) / 2
      + position * (bounds.right - bounds.left) * 0.48;
    drawLabel(label, x, bounds.bottom + 14, colors.muted, align, 7);
  }
}

function drawSystemBackground(moment, progress) {
  if (state.studyId === "ouroboros-tape") drawOuroboros(moment, progress);
  else if (state.studyId === "spectral-mobius") drawSpectralMobius(moment, progress);
  else if (state.studyId === "filter-hydra") drawFilterHydra(moment);
  else if (state.studyId === "cantor-delay") drawCantorDelay(moment, progress);
  else if (state.studyId === "convolution-maw") drawConvolutionMaw(moment, progress);
  else drawPhaseLabyrinth(moment, progress);
}

function drawStage(moment, progress) {
  canvasSetup();
  const activeMoment = moment ?? plan.moments[0];
  drawing.save();
  drawing.globalAlpha = state.geometryView === "causality" ? 0.055 : 0.095;
  drawSystemBackground(activeMoment, progress);
  drawing.restore();
  if (state.geometryView === "stack") drawStackGeometry(activeMoment, progress);
  else if (state.geometryView === "causality") drawCausalityGeometry(activeMoment, progress);
  else drawOrbitGeometry(activeMoment, progress);
  drawMotionTopology(activeMoment, progress);
}

$("studyButtons").addEventListener("click", (event) => {
  const button = event.target.closest?.("[data-study]");
  if (button) selectStudy(button.dataset.study);
});
$("studyButtons").addEventListener("keydown", (event) => {
  if (!["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(event.key)) return;
  event.preventDefault();
  const direction = ["ArrowDown", "ArrowRight"].includes(event.key) ? 1 : -1;
  const currentIndex = studyIndexById.get(state.studyId) ?? 0;
  const nextIndex = (currentIndex + direction + studyIds.length) % studyIds.length;
  selectStudy(studyIds[nextIndex]);
  $("studyButtons").querySelector(`[data-study="${studyIds[nextIndex]}"]`)?.focus();
});
$("studySelect").addEventListener("change", (event) => selectStudy(event.currentTarget.value));
$("geometryViews").addEventListener("click", (event) => {
  const button = event.target.closest?.("[data-geometry]");
  const view = button?.dataset.geometry;
  if (!["orbit", "stack", "causality"].includes(view) || view === state.geometryView) return;
  state.geometryView = view;
  paintGeometryViews();
  paintReadout(currentTransportState().moment);
  $("liveStatus").textContent = view === "orbit"
    ? "Orbit view: rhythm circles the twisted manifold while phrase, spectrum, pitch, pan, and polarity deform it."
    : view === "stack"
      ? "Stack view: output time and logarithmic spectrum are layered through recursive time."
      : "Causality view: source phrase positions braid through actual DSP routes into audible output onsets.";
  scheduleFrame();
});
$("sourceButtons").addEventListener("click", (event) => {
  const button = event.target.closest?.("[data-source]");
  if (button) selectSource(button.dataset.source);
});
$("audioButton").addEventListener("click", togglePlayback);
$("listenButton").addEventListener("click", togglePlayback);
$("stepButton").addEventListener("click", stepForward);
$("restartButton").addEventListener("click", restartStudy);

$("depth").addEventListener("input", (event) => {
  currentSettings().depth = Math.round(Number(event.currentTarget.value));
  $("depthOut").textContent = currentStudy().parameters.depth.format(currentSettings().depth);
  updatePlan();
});
$("depth").addEventListener("change", queuePreparedRestart);
$("pace").addEventListener("input", (event) => {
  currentSettings().pace = Number(event.currentTarget.value);
  $("paceOut").textContent = `${currentSettings().pace.toFixed(2)} seconds`;
  updatePlan();
});
$("pace").addEventListener("change", () => {
  if (state.playing) restartTransport();
});
$("transform").addEventListener("input", (event) => {
  currentSettings().transform = Number(event.currentTarget.value);
  $("transformOut").textContent = currentStudy().parameters.transform.format(currentSettings().transform);
  updatePlan();
});
$("transform").addEventListener("change", queuePreparedRestart);
$("intensity").addEventListener("input", (event) => {
  currentSettings().intensity = Number(event.currentTarget.value);
  $("intensityOut").textContent = `${Math.round(currentSettings().intensity * 100)}% · ${pressureDescription(currentSettings().intensity)}`;
  updatePlan();
});
$("intensity").addEventListener("change", queuePreparedRestart);
$("level").addEventListener("input", (event) => {
  state.level = Number(event.currentTarget.value);
  $("levelOut").textContent = `${Math.round(state.level * 100)}%`;
  audio.setLevel(state.level);
});

$("accumulateButton").addEventListener("click", () => {
  state.accumulate = !state.accumulate;
  paintStudyControls();
  if (state.playing) restartTransport();
});
$("overwhelmButton").addEventListener("click", () => {
  const study = currentStudy();
  currentSettings().depth = study.parameters.depth.max;
  currentSettings().transform = study.parameters.transform.max;
  currentSettings().intensity = study.parameters.intensity.max;
  currentSettings().pace = study.parameters.pace.min;
  state.accumulate = true;
  paintStudyControls();
  updatePlan();
  queuePreparedRestart();
  $("liveStatus").textContent = "Event horizon opened. Maximum finite structure, master level unchanged.";
});
$("resetStudy").addEventListener("click", () => {
  const study = currentStudy();
  settings[state.studyId] = {
    depth: study.defaults.depth,
    pace: study.defaults.pace,
    transform: study.defaults.transform,
    intensity: study.defaults.intensity,
  };
  state.accumulate = true;
  paintStudyControls();
  updatePlan();
  if (state.playing) queuePreparedRestart();
});

$("audioFile").addEventListener("change", async (event) => {
  const file = event.currentTarget.files?.[0];
  if (!file) return;
  $("fileLabel").textContent = `Decoding ${file.name}`;
  $("fileHint").textContent = "local processing only";
  try {
    await audio.decodeFile(await file.arrayBuffer(), file.name);
    state.source = "file";
    $("fileLabel").textContent = file.name;
    $("fileHint").textContent = "ready · first four seconds · never uploaded";
    paintSource();
    updatePlan();
    if (state.playing) queuePreparedRestart();
  } catch (error) {
    $("audioError").textContent = error instanceof Error ? error.message : "This audio file could not be decoded.";
    $("audioError").hidden = false;
    $("fileLabel").textContent = "Choose another audio file";
  }
});

$("captureButton").addEventListener("click", async () => {
  if (state.captureProgress > 0 && state.captureProgress < 1) {
    audio.stopCapture();
    return;
  }
  setPressed($("captureButton"), true);
  $("captureLabel").textContent = "Capturing…";
  $("captureHint").textContent = "0.0 / 4.0 s · never monitored";
  state.captureProgress = 0.001;
  try {
    await audio.captureMicrophone(4, (progress) => {
      state.captureProgress = progress;
      $("captureHint").textContent = `${(progress * 4).toFixed(1)} / 4.0 s · never monitored`;
      scheduleFrame();
    });
    state.source = "mic";
    $("captureLabel").textContent = "Capture ready";
    $("captureHint").textContent = "4.0 s · microphone closed · capture again";
    paintSource();
    updatePlan();
    if (state.playing) queuePreparedRestart();
  } catch (error) {
    if (!/stopped/i.test(error?.message ?? "")) {
      $("audioError").textContent = error instanceof Error ? error.message : "Microphone capture failed.";
      $("audioError").hidden = false;
    }
    $("captureLabel").textContent = "Capture four seconds";
    $("captureHint").textContent = "captured · never live-monitored";
  } finally {
    state.captureProgress = 0;
    setPressed($("captureButton"), false);
  }
});

function frame() {
  scheduledFrame = 0;
  const now = audio.context?.currentTime ?? performance.now() / 1_000;
  if (state.playing) scheduleTransport(now);
  const transport = currentTransportState();
  if (transport.moment) announce(transport.moment);
  paintTimeline(transport.elapsed, transport.moment);
  paintRail(transport.moment);
  paintReadout(transport.moment);
  $("processLabel").textContent = transport.moment?.label ?? "seed waiting at generation zero";
  if (!reducedMotion || now - lastReducedPaint > 0.12) {
    drawStage(transport.moment, transport.progress);
    lastReducedPaint = now;
  }
  if (state.playing || (state.captureProgress > 0 && state.captureProgress < 1)) scheduleFrame();
}

document.addEventListener("visibilitychange", () => {
  if (document.hidden) {
    if (state.playing) setPlaying(false);
    if (state.captureProgress > 0) audio.stopCapture();
  }
});
globalThis.addEventListener?.("pagehide", () => audio.destroy(), { once: true });
globalThis.addEventListener?.("keydown", (event) => {
  if (event.key === "Escape") {
    if (state.playing) setPlaying(false);
    if (state.captureProgress > 0) audio.stopCapture();
  }
  if (event.code === "Space" && event.target === canvas) {
    event.preventDefault();
    togglePlayback();
  }
});

paintStudyControls();
paintTimeline(0, null);
paintRail(null);
scheduleFrame();

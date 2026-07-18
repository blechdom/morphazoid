import { clamp, levelToGain } from "./src/audio.js";
import {
  addContourVertex,
  fadeLoopEdges,
  loopPhaseAtTime,
  MAX_VERTEX_COUNT,
  MIN_VERTEX_COUNT,
  moveVertex,
  pointOnContour,
  presetVertices,
  removeContourVertex,
  reverseSamples,
  scrubPhaseFromAngle,
  scrubRateFromMotion,
  timeStretchLoopSamples,
  waveformEnvelope,
  wrap01,
} from "./src/lumber.js";

const $ = (id) => document.getElementById(id);
const TAU = Math.PI * 2;
const DEFAULT_VERTEX_COUNT = 12;
const DRAW_SAMPLES = 360;
const MAX_RECORD_SECONDS = 30;
const MIN_RECORD_SECONDS = 0.15;
const MAX_RINGS = 5;
const MIN_RADIAL_OFFSET = -0.42;
const MAX_RADIAL_OFFSET = 0.62;
const STORAGE_KEY = "morphazoid:lumber:audio:v2";
const RING_COLORS = ["#e8c46b", "#5fe8c4", "#7db4ff", "#c79bff", "#ff826f"];
const CANVAS_FONT = 'ui-monospace, "SF Mono", Menlo, Consolas, monospace';
const expandedMode = document.body?.dataset?.lumberMode === "expanded";

let nextRingId = 1;

function createRing(order = 0) {
  const id = nextRingId++;
  return {
    id,
    order,
    depth: order * 0.22,
    color: RING_COLORS[(id - 1) % RING_COLORS.length],
    preset: "circle",
    vertices: presetVertices("circle", DEFAULT_VERTEX_COUNT),
    radialOffsets: Array(DEFAULT_VERTEX_COUNT).fill(0),
    radialBaseMode: "circle",
    selectedVertex: 0,
    muted: false,
    rawSamples: null,
    sampleRate: 48_000,
    timeStretch: expandedMode ? 0.65 : 0,
    pitchSemitones: 0,
    timingMode: "free",
    lengthRatio: 1,
    buffer: null,
    reverseBuffer: null,
    envelope: waveformEnvelope([], DRAW_SAMPLES),
    duration: 0,
    direction: 1,
    phase: 0,
    phaseAnchor: 0,
    phaseAnchorTime: 0,
    phaseAnchorDirection: 1,
    source: null,
    scrubVoice: null,
    lastScrubAt: -Infinity,
  };
}

const firstRing = createRing();
const state = {
  audio: false,
  playing: false,
  recording: false,
  scrubbing: false,
  backingDuringRecord: false,
  view3d: false,
  viewTilt: 52,
  viewYaw: -18,
  level: 0.7,
  rings: [firstRing],
  activeRingId: firstRing.id,
  soloRingId: null,
};

try {
  const stored = JSON.parse(globalThis.localStorage?.getItem(STORAGE_KEY) ?? "null");
  if (stored && Number.isFinite(Number(stored.level))) {
    state.level = clamp(Number(stored.level), 0, 1);
  }
  if (stored && typeof stored.backingDuringRecord === "boolean") {
    state.backingDuringRecord = stored.backingDuringRecord;
  }
} catch {
  // Persistence is optional.
}

const canvas = $("stage");
const context = canvas.getContext("2d");
const stageWrap = $("stageWrap");

let cssWidth = 1;
let cssHeight = 1;
let pixelRatio = 1;
let scheduledFrame = 0;
let lastUiUpdate = 0;
let pointerGesture = null;
let hoverVertex = -1;
let audioChanging = false;
let recordChanging = false;
let transportGeneration = 0;

let audioContext = null;
let masterGain = null;
let masterLimiter = null;

let mediaStream = null;
let microphoneSource = null;
let captureProcessor = null;
let captureMute = null;
let recordingChunks = [];
let recordingSampleCount = 0;
let recordingSampleRate = 48_000;
let liveSamples = new Float32Array(0);
let recordingTargetId = null;
let recordingSession = null;
let captureGeneration = 0;
let autoStopRequested = false;

function setPressed(element, pressed) {
  element?.setAttribute("aria-pressed", String(Boolean(pressed)));
}

function announce(message) {
  $("liveStatus").textContent = message;
}

function showError(message) {
  $("audioError").textContent = message;
  $("audioError").hidden = false;
}

function clearError() {
  $("audioError").hidden = true;
}

function scheduleFrame() {
  if (!scheduledFrame) scheduledFrame = requestAnimationFrame(frame);
}

function colorWithAlpha(color, alpha) {
  const hex = String(color).replace("#", "");
  const value = Number.parseInt(hex, 16);
  if (hex.length !== 6 || !Number.isFinite(value)) return `rgba(232,196,107,${alpha})`;
  return `rgba(${value >> 16},${(value >> 8) & 255},${value & 255},${alpha})`;
}

function sampleRadialOffsets(offsets, phase) {
  if (!offsets?.length) return 0;
  const position = wrap01(phase) * offsets.length;
  const first = Math.floor(position) % offsets.length;
  const second = (first + 1) % offsets.length;
  const amount = position - Math.floor(position);
  return offsets[first] + (offsets[second] - offsets[first]) * amount;
}

function resizeRadialOffsets(offsets, count) {
  const nextCount = Math.round(clamp(count, MIN_VERTEX_COUNT, MAX_VERTEX_COUNT));
  return Array.from({ length: nextCount }, (_, index) => (
    sampleRadialOffsets(offsets, index / nextCount)
  ));
}

function regularPolygonRadius(count, phase) {
  if (count < 3) return 1;
  const local = (wrap01(phase) * count) % 1;
  const angle = (local - 0.5) * TAU / count;
  return Math.cos(Math.PI / count) / Math.max(0.1, Math.cos(angle));
}

function radialPointAt(ring, phase) {
  const count = ring.radialOffsets.length;
  const baseRadius = ring.radialBaseMode === "polygon"
    ? regularPolygonRadius(count, phase)
    : 1;
  const radius = Math.max(0.12, baseRadius + sampleRadialOffsets(ring.radialOffsets, phase));
  const angle = -Math.PI / 2 + wrap01(phase) * TAU;
  return { x: Math.cos(angle) * radius, y: Math.sin(angle) * radius };
}

function ringVertexCount(ring) {
  return expandedMode ? ring.radialOffsets.length : ring.vertices.length;
}

function ringAudioVertices(ring) {
  if (!expandedMode) return ring.vertices;
  return Array.from({ length: 64 }, (_, index) => radialPointAt(ring, index / 64));
}

function persistSettings() {
  try {
    globalThis.localStorage?.setItem(STORAGE_KEY, JSON.stringify({
      level: state.level,
      backingDuringRecord: state.backingDuringRecord,
    }));
  } catch {
    // Audio remains usable without storage.
  }
}

function orderedRings() {
  return [...state.rings].sort((first, second) => first.order - second.order);
}

function ringById(id) {
  return state.rings.find((ring) => ring.id === id) ?? null;
}

function activeRing() {
  return ringById(state.activeRingId) ?? state.rings[0];
}

function ringIsAudible(ring) {
  return Boolean(ring)
    && !ring.muted
    && (state.soloRingId === null || state.soloRingId === ring.id);
}

function recordedRings() {
  return state.rings.filter((ring) => ring.buffer && ring.reverseBuffer);
}

function masterRing() {
  return orderedRings().find((ring) => ring.buffer) ?? null;
}

function ringOrdinal(ring) {
  return orderedRings().findIndex((item) => item.id === ring.id) + 1;
}

function ringScale(ring) {
  const rings = orderedRings();
  const index = rings.findIndex((item) => item.id === ring.id);
  const center = (rings.length - 1) / 2;
  return 1 + (index - center) * 0.18;
}

function ringPlaybackRate(ring) {
  const cycle = ringCycleDuration(ring);
  return cycle > 0 ? ring.duration / cycle : 1;
}

function ringCycleDuration(ring) {
  if (!ring?.duration) return 0;
  const tapeRate = 2 ** (clamp(ring.pitchSemitones ?? 0, -12, 12) / 12);
  const freeCycle = ring.duration / tapeRate * (expandedMode ? ring.lengthRatio : 1);
  const master = masterRing();
  if (
    expandedMode
    && ring.timingMode === "sync"
    && master
    && master.id !== ring.id
  ) {
    const masterRate = 2 ** (clamp(master.pitchSemitones ?? 0, -12, 12) / 12);
    return Math.max(0.01, master.duration / masterRate * master.lengthRatio * ring.lengthRatio);
  }
  return Math.max(0.01, freeCycle);
}

function currentPhase(ring = activeRing()) {
  if (
    !state.playing
    || (state.scrubbing && ring.id === state.activeRingId)
    || !audioContext
    || ringCycleDuration(ring) <= 0
  ) {
    return wrap01(ring.phase);
  }
  return loopPhaseAtTime(
    ring.phaseAnchor,
    Math.max(0, audioContext.currentTime - ring.phaseAnchorTime),
    ringCycleDuration(ring),
    ring.phaseAnchorDirection,
  );
}

function anchorRing(ring, phase = ring.phase) {
  ring.phase = wrap01(phase);
  ring.phaseAnchor = ring.phase;
  ring.phaseAnchorTime = audioContext?.currentTime ?? 0;
  ring.phaseAnchorDirection = ring.direction;
}

function captureRingPhase(ring) {
  anchorRing(ring, currentPhase(ring));
  return ring.phase;
}

function stopVoice(voice, fadeSeconds = 0.004) {
  if (!voice) return;
  const now = audioContext?.currentTime ?? 0;
  voice.gain?.gain.cancelScheduledValues?.(now);
  voice.gain?.gain.setTargetAtTime?.(0, now, fadeSeconds);
  voice.source.onended = () => {
    try {
      voice.source.disconnect();
      voice.gain?.disconnect();
    } catch {
      // Nodes may already be disconnected during teardown.
    }
  };
  try {
    voice.source.stop(now + 0.025);
  } catch {
    voice.source.onended?.();
  }
}

function stopRingSource(ring) {
  if (!ring?.source) return;
  const voice = ring.source;
  ring.source = null;
  stopVoice(voice);
}

function scheduleEqualPowerGain(param, direction, startTime, duration, peak = 0.72) {
  const samples = 24;
  const curve = new Float32Array(samples);
  for (let index = 0; index < samples; index += 1) {
    const phase = index / (samples - 1) * Math.PI / 2;
    curve[index] = peak * (direction === "in" ? Math.sin(phase) : Math.cos(phase));
  }
  param.cancelScheduledValues?.(startTime);
  if (typeof param.setValueCurveAtTime === "function") {
    param.setValueCurveAtTime(curve, startTime, duration);
  } else if (typeof param.linearRampToValueAtTime === "function") {
    param.setValueAtTime?.(curve[0], startTime);
    param.linearRampToValueAtTime(curve[curve.length - 1], startTime + duration);
  } else {
    param.setTargetAtTime?.(curve[curve.length - 1], startTime, duration / 4);
  }
}

function fadeScrubVoice(voice, duration = 0.02) {
  if (!voice || !audioContext) return;
  const now = audioContext.currentTime;
  scheduleEqualPowerGain(voice.gain.gain, "out", now, duration, 0.72);
  try {
    voice.source.stop(now + duration + 0.006);
  } catch {
    voice.source.onended?.();
  }
}

function stopScrubVoice(ring) {
  if (!ring?.scrubVoice) return;
  const voice = ring.scrubVoice;
  ring.scrubVoice = null;
  fadeScrubVoice(voice);
}

function startRingSource(ring) {
  stopRingSource(ring);
  if (!state.playing || !audioContext || !masterGain || !ring?.buffer) return;
  const source = audioContext.createBufferSource();
  source.buffer = ring.direction > 0 ? ring.buffer : ring.reverseBuffer;
  source.loop = true;
  source.loopStart = 0;
  source.loopEnd = source.buffer.duration;
  source.playbackRate.setValueAtTime(ringPlaybackRate(ring), audioContext.currentTime);
  const gain = audioContext.createGain();
  gain.gain.value = 0;
  source.connect(gain);
  gain.connect(masterGain);
  const sourcePhase = ring.direction > 0 ? ring.phase : wrap01(1 - ring.phase);
  const offset = Math.min(
    sourcePhase * source.buffer.duration,
    Math.max(0, source.buffer.duration - 1 / Math.max(1, source.buffer.sampleRate)),
  );
  source.start(0, offset);
  gain.gain.setTargetAtTime(ringIsAudible(ring) ? 1 : 0, audioContext.currentTime, 0.006);
  ring.source = { source, gain };
  anchorRing(ring, ring.phase);
}

function playScrubGrain(ring, scrubRate = ringPlaybackRate(ring)) {
  if (!audioContext || !masterGain || !state.audio || !ring?.buffer || !ringIsAudible(ring)) return;
  const nowMs = performance.now();
  if (nowMs - ring.lastScrubAt < 24) return;
  ring.lastScrubAt = nowMs;
  if (ring.scrubVoice) fadeScrubVoice(ring.scrubVoice);
  const source = audioContext.createBufferSource();
  source.buffer = ring.direction > 0 ? ring.buffer : ring.reverseBuffer;
  source.loop = true;
  source.loopStart = 0;
  source.loopEnd = source.buffer.duration;
  source.playbackRate.setValueAtTime(clamp(scrubRate, 0.2, 4), audioContext.currentTime);
  const gain = audioContext.createGain();
  gain.gain.value = 0;
  source.connect(gain);
  gain.connect(masterGain);
  const sourcePhase = ring.direction > 0 ? ring.phase : wrap01(1 - ring.phase);
  source.start(0, Math.min(
    sourcePhase * source.buffer.duration,
    Math.max(0, source.buffer.duration - 1 / Math.max(1, source.buffer.sampleRate)),
  ));
  scheduleEqualPowerGain(gain.gain, "in", audioContext.currentTime, 0.02, 0.72);
  gain.gain.setTargetAtTime(0, audioContext.currentTime + 0.065, 0.012);
  source.stop(audioContext.currentTime + 0.11);
  const voice = { source, gain };
  ring.scrubVoice = voice;
  source.onended = () => {
    if (ring.scrubVoice === voice) ring.scrubVoice = null;
    try {
      source.disconnect();
      gain.disconnect();
    } catch {
      // A newer grain may already have cleaned this one up.
    }
  };
}

function stopAllRingSources({ capturePhase = true } = {}) {
  for (const ring of state.rings) {
    if (capturePhase && ring.buffer) captureRingPhase(ring);
    stopRingSource(ring);
    stopScrubVoice(ring);
  }
}

function startAllRingSources() {
  if (expandedMode) {
    const master = masterRing();
    const masterPhase = master ? currentPhase(master) : 0;
    for (const ring of recordedRings()) {
      if (ring.timingMode === "sync" && master && ring.id !== master.id) {
        ring.phase = wrap01(masterPhase / Math.max(0.01, ring.lengthRatio));
        anchorRing(ring, ring.phase);
      }
    }
  }
  for (const ring of recordedRings()) startRingSource(ring);
}

function paintMasterGain() {
  if (!masterGain || !audioContext) return;
  const audible = recordedRings().filter((ring) => (
    ringIsAudible(ring)
    && !(state.recording && state.backingDuringRecord && ring.id === recordingTargetId)
  ));
  const target = state.audio
    ? levelToGain(state.level) / Math.sqrt(Math.max(1, audible.length))
    : 0;
  masterGain.gain.cancelScheduledValues(audioContext.currentTime);
  masterGain.gain.setTargetAtTime(target, audioContext.currentTime, 0.012);
}

async function ensureAudio() {
  const AudioContextClass = globalThis.AudioContext ?? globalThis.webkitAudioContext;
  if (!AudioContextClass) throw new Error("Web Audio is not available in this browser.");
  if (!audioContext || audioContext.state === "closed") {
    audioContext = new AudioContextClass();
    masterGain = audioContext.createGain();
    masterGain.gain.value = 0;
    if (typeof audioContext.createDynamicsCompressor === "function") {
      masterLimiter = audioContext.createDynamicsCompressor();
      masterLimiter.threshold?.setValueAtTime?.(-8, audioContext.currentTime);
      masterLimiter.knee?.setValueAtTime?.(6, audioContext.currentTime);
      masterLimiter.ratio?.setValueAtTime?.(12, audioContext.currentTime);
      masterLimiter.attack?.setValueAtTime?.(0.003, audioContext.currentTime);
      masterLimiter.release?.setValueAtTime?.(0.16, audioContext.currentTime);
      masterGain.connect(masterLimiter);
      masterLimiter.connect(audioContext.destination);
    } else {
      masterGain.connect(audioContext.destination);
    }
  }
  if (audioContext.state === "suspended") await audioContext.resume();
  paintMasterGain();
  return audioContext;
}

async function setAudioEnabled(enabled, shouldAnnounce = true) {
  if (enabled) {
    try {
      await ensureAudio();
      state.audio = true;
      clearError();
    } catch (error) {
      state.audio = false;
      showError(error instanceof Error ? error.message : "Audio could not start.");
      updateUi();
      return false;
    }
  } else {
    state.audio = false;
  }
  paintMasterGain();
  updateUi();
  if (shouldAnnounce) announce(state.audio ? "Loop audio on." : "Loop audio off.");
  return state.audio;
}

async function toggleAudio() {
  if (audioChanging) return;
  audioChanging = true;
  $("audioButton").disabled = true;
  $("audioState").textContent = state.audio ? "stopping…" : "starting…";
  try {
    await setAudioEnabled(!state.audio);
  } finally {
    audioChanging = false;
    $("audioButton").disabled = false;
    updateUi();
  }
}

async function setPlaying(playing, shouldAnnounce = true) {
  const generation = ++transportGeneration;
  const next = Boolean(playing);
  if (next && (state.recording || recordChanging)) {
    announce("Finish recording before starting playback.");
    return false;
  }
  if (next && !recordedRings().length) {
    announce("Record a ring first.");
    return false;
  }
  if (next === state.playing && !state.scrubbing) return state.playing;
  if (next) {
    const enabled = await setAudioEnabled(true, false);
    if (
      generation !== transportGeneration
      || !enabled
      || state.recording
      || recordChanging
      || !recordedRings().length
    ) {
      return state.playing;
    }
    state.playing = true;
    state.scrubbing = false;
    for (const ring of recordedRings()) anchorRing(ring, ring.phase);
    startAllRingSources();
  } else {
    stopAllRingSources();
    state.playing = false;
    state.scrubbing = false;
  }
  updateUi();
  scheduleFrame();
  if (shouldAnnounce) announce(state.playing ? "All rings playing." : "All rings paused.");
  return state.playing;
}

function setDirection(direction) {
  const ring = activeRing();
  const next = direction < 0 ? -1 : 1;
  if (next === ring.direction) return;
  captureRingPhase(ring);
  ring.direction = next;
  if (state.playing && !state.scrubbing) startRingSource(ring);
  updateUi();
  scheduleFrame();
  announce(`Ring ${ringOrdinal(ring)} ${next < 0 ? "reversed" : "forward"}.`);
}

function setActiveRing(ring, shouldAnnounce = true) {
  if (!ring || ring.id === state.activeRingId) return;
  state.activeRingId = ring.id;
  hoverVertex = -1;
  updateUi();
  scheduleFrame();
  if (shouldAnnounce) announce(`Ring ${ringOrdinal(ring)} selected.`);
}

function setRingMuted(ring, muted) {
  if (!ring?.buffer) return;
  ring.muted = Boolean(muted);
  if (ring.muted) stopScrubVoice(ring);
  if (ring.muted && state.soloRingId === ring.id) state.soloRingId = null;
  refreshRingAudibility();
  announce(`Ring ${ringOrdinal(ring)} ${ring.muted ? "muted" : "unmuted"}.`);
}

function refreshRingAudibility() {
  const now = audioContext?.currentTime ?? 0;
  for (const ring of state.rings) {
    const audible = ringIsAudible(ring);
    if (!audible) stopScrubVoice(ring);
    ring.source?.gain.gain.cancelScheduledValues?.(now);
    ring.source?.gain.gain.setTargetAtTime?.(audible ? 1 : 0, now, 0.01);
  }
  paintMasterGain();
  updateUi();
  scheduleFrame();
}

function toggleRingSolo(ring) {
  if (!ring?.buffer) return;
  state.soloRingId = state.soloRingId === ring.id ? null : ring.id;
  refreshRingAudibility();
  announce(state.soloRingId === ring.id
    ? `Ring ${ringOrdinal(ring)} soloed.`
    : "Ring solo cleared.");
}

function removeRing(ring) {
  if (!ring || state.recording || recordChanging || state.rings.length <= 1) return;
  const rings = orderedRings();
  const index = rings.findIndex((item) => item.id === ring.id);
  stopRingSource(ring);
  stopScrubVoice(ring);
  state.rings = state.rings.filter((item) => item.id !== ring.id);
  if (state.soloRingId === ring.id) state.soloRingId = null;
  const next = rings[index + 1] ?? rings[index - 1] ?? state.rings[0];
  state.activeRingId = next.id;
  if (!recordedRings().length) state.playing = false;
  refreshRingAudibility();
  announce("Ring deleted.");
}

function clearAllRings() {
  if (state.recording || recordChanging) return;
  stopAllRingSources({ capturePhase: false });
  transportGeneration += 1;
  state.playing = false;
  state.scrubbing = false;
  nextRingId = 1;
  const ring = createRing();
  state.rings = [ring];
  state.activeRingId = ring.id;
  state.soloRingId = null;
  pointerGesture = null;
  hoverVertex = -1;
  paintMasterGain();
  updateUi();
  scheduleFrame();
  announce("All rings cleared.");
}

function applyPreset(preset) {
  if (state.recording || recordChanging) return;
  const ring = activeRing();
  ring.preset = preset;
  if (expandedMode) {
    const count = preset === "triangle" ? 3 : preset === "square" ? 4 : DEFAULT_VERTEX_COUNT;
    ring.radialOffsets = Array(count).fill(0);
    ring.radialBaseMode = preset === "circle" ? "circle" : "polygon";
  } else {
    ring.vertices = presetVertices(preset, DEFAULT_VERTEX_COUNT);
  }
  ring.selectedVertex = 0;
  if (ring.rawSamples && ring.timeStretch > 0) rebuildRingAudio(ring);
  updateUi();
  scheduleFrame();
  announce(`${preset[0].toUpperCase()}${preset.slice(1)} contour seeded.`);
}

function addVertex() {
  if (state.recording || recordChanging) return;
  const ring = activeRing();
  if (ringVertexCount(ring) >= MAX_VERTEX_COUNT) return;
  if (expandedMode) {
    ring.radialOffsets = resizeRadialOffsets(ring.radialOffsets, ring.radialOffsets.length + 1);
  } else {
    ring.vertices = addContourVertex(ring.vertices);
  }
  ring.selectedVertex = Math.min(ringVertexCount(ring) - 1, ring.selectedVertex + 1);
  ring.preset = "custom";
  if (ring.rawSamples && ring.timeStretch > 0) rebuildRingAudio(ring);
  updateUi();
  scheduleFrame();
  announce(`${ringVertexCount(ring)} ${expandedMode ? "radial" : "free"} vertices.`);
}

function removeVertex() {
  if (state.recording || recordChanging) return;
  const ring = activeRing();
  if (ringVertexCount(ring) <= MIN_VERTEX_COUNT) return;
  if (expandedMode) {
    ring.radialOffsets.splice(ring.selectedVertex, 1);
  } else {
    ring.vertices = removeContourVertex(ring.vertices, ring.selectedVertex);
  }
  ring.selectedVertex = Math.min(ring.selectedVertex, ringVertexCount(ring) - 1);
  ring.preset = "custom";
  if (ring.rawSamples && ring.timeStretch > 0) rebuildRingAudio(ring);
  updateUi();
  scheduleFrame();
  announce(`${ringVertexCount(ring)} ${expandedMode ? "radial" : "free"} vertices.`);
}

function setTimeMode(mode) {
  if (state.recording || recordChanging) return;
  const ring = activeRing();
  ring.timeStretch = mode === "local" ? Math.max(0.5, ring.timeStretch) : 0;
  if (ring.rawSamples) rebuildRingAudio(ring);
  updateUi();
  scheduleFrame();
  announce(ring.timeStretch > 0 ? "Local shape time stretch enabled." : "Native ring timing restored.");
}

function setTimeStretch(value) {
  if (state.recording || recordChanging) return;
  const ring = activeRing();
  ring.timeStretch = clamp(Number(value), 0, 1);
  if (ring.rawSamples) rebuildRingAudio(ring);
  updateUi();
  scheduleFrame();
}

function setPitchSemitones(value) {
  if (state.recording || recordChanging) return;
  const ring = activeRing();
  const wasPlaying = state.playing && Boolean(ring.buffer);
  if (wasPlaying) captureRingPhase(ring);
  if (wasPlaying) stopRingSource(ring);
  ring.pitchSemitones = Math.round(clamp(Number(value), -12, 12));
  anchorRing(ring, ring.phase);
  if (wasPlaying) startRingSource(ring);
  updateUi();
  scheduleFrame();
}

function spreadRingDepths() {
  const rings = orderedRings();
  const center = (rings.length - 1) / 2;
  rings.forEach((ring, index) => {
    ring.depth = clamp((index - center) * 0.34, -1, 1);
  });
  updateUi();
  scheduleFrame();
  announce("Rings spread across the depth axis.");
}

function setThreeDView(enabled) {
  state.view3d = Boolean(enabled);
  if (
    state.view3d
    && state.rings.length > 1
    && state.rings.every((ring) => Math.abs(ring.depth) < 0.001)
  ) {
    spreadRingDepths();
  }
  updateUi();
  scheduleFrame();
  announce(state.view3d ? "Three dimensional view enabled." : "Flat view enabled.");
}

function stopStream(stream) {
  for (const track of stream?.getTracks?.() ?? []) track.stop();
}

function releaseCapture() {
  if (captureProcessor) captureProcessor.onaudioprocess = null;
  for (const node of [microphoneSource, captureProcessor, captureMute]) {
    try {
      node?.disconnect();
    } catch {
      // Nodes can already be disconnected after a device error.
    }
  }
  stopStream(mediaStream);
  mediaStream = null;
  microphoneSource = null;
  captureProcessor = null;
  captureMute = null;
}

function microphoneErrorMessage(error) {
  if (error?.name === "NotAllowedError" || error?.name === "SecurityError") {
    return "Microphone access was blocked. Allow it for this site, then try again.";
  }
  if (error?.name === "NotFoundError") return "No microphone input was found.";
  return error instanceof Error ? error.message : "The microphone could not start.";
}

function createOuterRing() {
  const maximumOrder = Math.max(...state.rings.map((ring) => ring.order));
  const ring = createRing(maximumOrder + 1);
  state.rings.push(ring);
  state.activeRingId = ring.id;
  return ring;
}

async function restoreRecordingSession({ resumePlayback = true, removeCreated = true } = {}) {
  const session = recordingSession;
  recordingSession = null;
  recordingTargetId = null;
  if (!session) return;
  const target = ringById(session.targetId);
  if (target) {
    target.phase = session.targetPhase;
    target.direction = session.targetDirection;
    anchorRing(target, target.phase);
  }
  if (removeCreated && session.createdRingId) {
    const created = ringById(session.createdRingId);
    if (created) {
      state.rings = state.rings.filter((ring) => ring.id !== created.id);
      state.activeRingId = session.previousActiveId;
    }
  }
  if (resumePlayback && session.wasPlaying && recordedRings().length) {
    if (state.playing && target?.buffer) startRingSource(target);
    else await setPlaying(true, false);
  }
}

async function beginRecording({ replace = false } = {}) {
  if (state.recording) {
    await finishRecording();
    return;
  }
  if (recordChanging) return;
  if (!replace && state.rings.length >= MAX_RINGS && recordedRings().length) {
    showError(`Lumber supports ${MAX_RINGS} rings in this proof of concept.`);
    announce("Delete a ring before recording another.");
    return;
  }

  const previousActive = activeRing();
  let target = previousActive;
  let createdRingId = null;
  const firstEmpty = state.rings.length === 1 && !state.rings[0].buffer;
  if (!replace && !firstEmpty) {
    target = createOuterRing();
    createdRingId = target.id;
  }
  setActiveRing(target, false);

  const generation = ++captureGeneration;
  recordChanging = true;
  clearError();
  updateUi();
  scheduleFrame();

  try {
    const audio = await ensureAudio();
    if (generation !== captureGeneration || document.hidden) return;
    if (!globalThis.navigator?.mediaDevices?.getUserMedia) {
      throw new Error("Microphone recording requires HTTPS or localhost.");
    }
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        channelCount: { ideal: 1 },
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: false,
      },
    });
    if (generation !== captureGeneration || document.hidden) {
      stopStream(stream);
      return;
    }

    recordingSession = {
      mode: replace ? "replace" : "new",
      targetId: target.id,
      createdRingId,
      previousActiveId: previousActive.id,
      targetPhase: currentPhase(target),
      targetDirection: target.direction,
      wasPlaying: state.playing,
    };
    if (state.backingDuringRecord && state.playing) {
      captureRingPhase(target);
      stopRingSource(target);
    } else {
      await setPlaying(false, false);
    }

    releaseCapture();
    mediaStream = stream;
    for (const track of stream.getTracks?.() ?? []) {
      track.addEventListener?.("ended", () => {
        if (generation === captureGeneration && state.recording) {
          void finishRecording({ playAfterCapture: false });
        }
      }, { once: true });
    }
    microphoneSource = audio.createMediaStreamSource(stream);
    const createProcessor = audio.createScriptProcessor?.bind(audio)
      ?? audio.createJavaScriptNode?.bind(audio);
    if (!createProcessor) {
      throw new Error("Uncompressed loop recording is not supported in this browser.");
    }
    captureProcessor = createProcessor(2048, 1, 1);
    captureMute = audio.createGain();
    captureMute.gain.value = 0;
    recordingChunks = [];
    recordingSampleCount = 0;
    recordingSampleRate = audio.sampleRate;
    liveSamples = new Float32Array(0);
    autoStopRequested = false;
    state.recording = true;
    recordingTargetId = target.id;
    target.phase = 0;
    target.direction = 1;
    paintMasterGain();

    captureProcessor.onaudioprocess = (event) => {
      if (!state.recording || generation !== captureGeneration) return;
      const input = event.inputBuffer.getChannelData(0);
      const maximumSamples = Math.round(recordingSampleRate * MAX_RECORD_SECONDS);
      const remaining = maximumSamples - recordingSampleCount;
      if (remaining <= 0) return;
      const chunk = Float32Array.from(
        remaining < input.length ? input.subarray(0, remaining) : input,
      );
      recordingChunks.push(chunk);
      recordingSampleCount += chunk.length;
      liveSamples = chunk;
      scheduleFrame();
      if (recordingSampleCount >= maximumSamples && !autoStopRequested) {
        autoStopRequested = true;
        queueMicrotask(() => {
          if (state.recording) void finishRecording();
        });
      }
    };
    microphoneSource.connect(captureProcessor);
    captureProcessor.connect(captureMute);
    captureMute.connect(audio.destination);
    announce(`${replace ? "Replacing" : "Recording new"} ring ${ringOrdinal(target)}.`);
  } catch (error) {
    if (generation !== captureGeneration) return;
    state.recording = false;
    releaseCapture();
    paintMasterGain();
    await restoreRecordingSession({ resumePlayback: true, removeCreated: true });
    showError(microphoneErrorMessage(error));
    announce("Recording could not start.");
  } finally {
    if (generation === captureGeneration) recordChanging = false;
    updateUi();
    scheduleFrame();
  }
}

function flattenRecording() {
  const samples = new Float32Array(recordingSampleCount);
  let offset = 0;
  for (const chunk of recordingChunks) {
    samples.set(chunk, offset);
    offset += chunk.length;
  }
  return samples;
}

function makeAudioBuffer(samples, sampleRate = recordingSampleRate) {
  const buffer = audioContext.createBuffer(1, samples.length, sampleRate);
  buffer.copyToChannel(samples, 0);
  return buffer;
}

function rebuildRingAudio(ring, { restart = true } = {}) {
  if (!ring?.rawSamples || !audioContext) return;
  const wasPlaying = restart && state.playing && Boolean(ring.buffer);
  if (wasPlaying) captureRingPhase(ring);
  if (wasPlaying) stopRingSource(ring);
  const processed = ring.timeStretch > 0
    ? timeStretchLoopSamples(ring.rawSamples, ringAudioVertices(ring), ring.timeStretch)
    : Float32Array.from(ring.rawSamples);
  ring.buffer = makeAudioBuffer(processed, ring.sampleRate);
  ring.reverseBuffer = makeAudioBuffer(reverseSamples(processed), ring.sampleRate);
  ring.envelope = waveformEnvelope(processed, DRAW_SAMPLES);
  ring.duration = ring.buffer.duration;
  anchorRing(ring, ring.phase);
  if (wasPlaying) startRingSource(ring);
}

async function finishRecording({ playAfterCapture = true } = {}) {
  if (!state.recording) return;
  state.recording = false;
  const sampleCount = recordingSampleCount;
  releaseCapture();
  paintMasterGain();
  const session = recordingSession;
  const target = ringById(recordingTargetId);

  if (!target || sampleCount < recordingSampleRate * MIN_RECORD_SECONDS) {
    recordingChunks = [];
    recordingSampleCount = 0;
    liveSamples = new Float32Array(0);
    await restoreRecordingSession({
      resumePlayback: playAfterCapture,
      removeCreated: true,
    });
    showError("The take was too short. The previous ring was left unchanged.");
    announce("Short take discarded.");
    updateUi();
    scheduleFrame();
    return;
  }

  const samples = fadeLoopEdges(flattenRecording(), recordingSampleRate);
  target.rawSamples = samples;
  target.sampleRate = recordingSampleRate;
  target.phase = 0;
  rebuildRingAudio(target, { restart: false });
  target.direction = 1;
  target.muted = false;
  recordingChunks = [];
  recordingSampleCount = 0;
  liveSamples = new Float32Array(0);
  autoStopRequested = false;
  recordingSession = null;
  recordingTargetId = null;
  clearError();

  if (playAfterCapture) {
    await setAudioEnabled(true, false);
    if (state.playing) startRingSource(target);
    else await setPlaying(true, false);
  } else if (session?.wasPlaying && state.backingDuringRecord) {
    startRingSource(target);
  }
  paintMasterGain();
  updateUi();
  scheduleFrame();
  announce(`${session?.mode === "replace" ? "Ring replaced" : "New ring recorded"} and ready.`);
}

function formatDuration(seconds) {
  if (!Number.isFinite(seconds) || seconds <= 0) return "empty";
  return seconds < 10 ? `${seconds.toFixed(2)} s` : `${seconds.toFixed(1)} s`;
}

function renderRingList(selectedRing) {
  $("ringList").innerHTML = orderedRings().map((ring, index) => {
    const soloed = state.soloRingId === ring.id;
    const status = ring.buffer
      ? `${formatDuration(ringCycleDuration(ring))}${ring.muted ? " · muted" : soloed ? " · solo" : ""}`
      : "empty";
    return `<div class="ring-list-row${ring.id === selectedRing.id ? " active" : ""}${soloed ? " solo" : ""}">`
      + `<button type="button" data-ring-action="select" data-ring-id="${ring.id}">`
      + `<i style="--ring-row-color:${ring.color}"></i><span>Ring ${index + 1}</span><small>${status}</small></button>`
      + `<button type="button" data-ring-action="mute" data-ring-id="${ring.id}" title="${ring.muted ? "Unmute" : "Mute"}" aria-label="${ring.muted ? "Unmute" : "Mute"} ring ${index + 1}"${ring.buffer ? "" : " disabled"}>${ring.muted ? "U" : "M"}</button>`
      + `<button type="button" data-ring-action="solo" data-ring-id="${ring.id}" title="${soloed ? "Clear solo" : "Solo"}" aria-label="${soloed ? "Clear solo on" : "Solo"} ring ${index + 1}"${ring.buffer ? "" : " disabled"}>S</button>`
      + `<button type="button" data-ring-action="delete" data-ring-id="${ring.id}" title="Delete" aria-label="Delete ring ${index + 1}"${state.rings.length <= 1 ? " disabled" : ""}>×</button></div>`;
  }).join("");
}

function updateUi() {
  const ring = activeRing();
  const ordinal = ringOrdinal(ring);
  const recorded = recordedRings();
  const locked = state.recording || recordChanging;
  const recordedSeconds = recordingSampleCount / Math.max(1, recordingSampleRate);

  setPressed($("audioButton"), state.audio);
  $("audioState").textContent = state.audio ? "on" : "off";
  setPressed($("recordButton"), state.recording);
  $("recordButton").disabled = recordChanging;
  $("recordLabel").textContent = recordChanging
    ? "Allow mic"
    : state.recording ? "Stop" : "Record new";
  $("recordHint").textContent = state.recording
    ? `${recordedSeconds.toFixed(1)} s · max ${MAX_RECORD_SECONDS}`
    : state.rings.length === 1 && !ring.buffer ? "fill first ring" : "create outer ring";
  $("recordButton").setAttribute(
    "aria-label",
    state.recording ? "Stop recording" : "Record a new outer ring",
  );

  setPressed($("playButton"), state.playing);
  $("playButton").disabled = !recorded.length || locked;
  $("playLabel").textContent = state.playing ? "Pause" : "Play";
  $("playButton").setAttribute("aria-label", state.playing ? "Pause all rings" : "Play all rings");

  $("durationOut").textContent = state.recording
    ? `${recordedSeconds.toFixed(1)} s`
    : formatDuration(ringCycleDuration(ring));
  $("ringMetricOut").textContent = `${ordinal} / ${state.rings.length}`;
  $("directionOut").textContent = ring.direction > 0 ? "forward" : "reverse";
  $("loopSummary").textContent = state.recording
    ? `ring ${ordinal} · recording`
    : ring.buffer ? `ring ${ordinal} · ${state.playing ? "playing" : "paused"}` : `ring ${ordinal} · empty`;

  $("activeRingOut").textContent = `Ring ${ordinal} of ${state.rings.length}`;
  $("activeRingOut").style.color = ring.color;
  $("ringSummary").textContent = `${state.rings.length} ${state.rings.length === 1 ? "ring" : "rings"} · active ${ordinal}`;
  renderRingList(ring);
  $("replaceRing").disabled = locked || !ring.buffer;
  $("clearAllRings").disabled = locked;

  for (const button of $("ringDirection").querySelectorAll("button")) {
    setPressed(button, Number(button.dataset.value) === ring.direction);
    button.disabled = locked;
  }
  for (const button of $("recordBacking").querySelectorAll("button")) {
    const enabled = button.dataset.value === "on";
    setPressed(button, enabled === state.backingDuringRecord);
    button.disabled = locked;
  }

  $("vertexCountOut").textContent = `${ringVertexCount(ring)} vertices`;
  $("removeVertex").disabled = locked || ringVertexCount(ring) <= MIN_VERTEX_COUNT;
  $("addVertex").disabled = locked || ringVertexCount(ring) >= MAX_VERTEX_COUNT;
  $("resetShape").disabled = locked;
  $("shapeSummary").textContent = `${ring.preset} · ${ringVertexCount(ring)} vertices`;
  for (const button of $("shapePreset").querySelectorAll("button")) {
    setPressed(button, button.dataset.value === ring.preset);
    button.disabled = locked;
  }

  const localTime = ring.timeStretch > 0;
  for (const button of $("timeMode").querySelectorAll("button")) {
    setPressed(button, (button.dataset.value === "local") === localTime);
    button.disabled = locked;
  }
  $("timeStretch").value = String(ring.timeStretch);
  $("timeStretch").disabled = locked || !localTime;
  $("timeStretchOut").textContent = `${Math.round(ring.timeStretch * 100)}%`;
  $("pitchShift").value = String(ring.pitchSemitones);
  $("pitchShift").disabled = locked;
  $("pitchShiftOut").textContent = `${ring.pitchSemitones > 0 ? "+" : ""}${Math.round(ring.pitchSemitones)} st`;
  $("advancedSummary").textContent = localTime || ring.pitchSemitones
    ? `${localTime ? `stretch ${Math.round(ring.timeStretch * 100)}%` : "native"} · ${ring.pitchSemitones > 0 ? "+" : ""}${ring.pitchSemitones} st`
    : "native";

  for (const button of $("viewMode").querySelectorAll("button")) {
    setPressed(button, (button.dataset.value === "3d") === state.view3d);
  }
  $("viewTilt").value = String(state.viewTilt);
  $("viewTiltOut").textContent = `${Math.round(state.viewTilt)}°`;
  $("viewYaw").value = String(state.viewYaw);
  $("viewYawOut").textContent = `${Math.round(state.viewYaw)}°`;
  $("ringDepth").value = String(ring.depth);
  $("ringDepthOut").textContent = `${Math.round(ring.depth * 100)}%`;
  $("viewTilt").disabled = !state.view3d;
  $("viewYaw").disabled = !state.view3d;
  $("ringDepth").disabled = !state.view3d;
  $("spreadDepth").disabled = !state.view3d || state.rings.length < 2;
  $("depthSummary").textContent = state.view3d
    ? `3D · ${Math.round(ring.depth * 100)}% depth`
    : "flat";

  $("level").value = String(state.level);
  $("levelOut").textContent = `${Math.round(state.level * 100)}%`;
  const sounding = recorded.filter((item) => ringIsAudible(item)).length;
  const stageState = state.recording
    ? `RECORDING ${recordedSeconds.toFixed(1)} S`
    : ring.buffer ? formatDuration(ringCycleDuration(ring)).toUpperCase() : "EMPTY RING";
  $("stageReadout").textContent = `${stageState} · RING ${ordinal}/${state.rings.length} · ${sounding} SOUNDING`;
  canvas.setAttribute(
    "aria-label",
    `Lumber ring ${ordinal} of ${state.rings.length}, ${ringVertexCount(ring)} ${expandedMode ? "radial" : "free"} vertices, ${ring.buffer ? formatDuration(ringCycleDuration(ring)) : "empty"}.`,
  );
}

function resizeCanvas() {
  const bounds = stageWrap.getBoundingClientRect();
  cssWidth = Math.max(1, Math.round(bounds.width));
  cssHeight = Math.max(1, Math.round(bounds.height));
  pixelRatio = Math.min(window.devicePixelRatio || 1, 2.5);
  canvas.width = Math.round(cssWidth * pixelRatio);
  canvas.height = Math.round(cssHeight * pixelRatio);
  scheduleFrame();
}

function stageGeometry() {
  const extent = Math.min(cssWidth, cssHeight);
  let maximum = 1;
  for (const ring of state.rings) {
    const vertices = expandedMode ? ringAudioVertices(ring) : ring.vertices;
    const vertexExtent = Math.max(
      1,
      ...vertices.map((vertex) => Math.hypot(vertex.x, vertex.y)),
    );
    maximum = Math.max(maximum, vertexExtent * ringScale(ring));
  }
  return {
    centerX: cssWidth * 0.5,
    centerY: cssHeight * 0.5,
    radius: Math.max(18, Math.min(extent * 0.28, (extent * 0.5 - 20) / (maximum * 1.18))),
  };
}

function envelopeSample(values, phase) {
  if (!values?.length) return 0;
  const position = wrap01(phase) * values.length;
  const first = Math.floor(position) % values.length;
  const second = (first + 1) % values.length;
  const amount = position - Math.floor(position);
  return values[first] + (values[second] - values[first]) * amount;
}

function activeEnvelope(ring) {
  if (state.recording && ring.id === recordingTargetId) {
    return waveformEnvelope(liveSamples, Math.min(DRAW_SAMPLES, liveSamples.length || 1));
  }
  return ring.envelope;
}

function projectRingPoint(x, y, ring, geometry) {
  if (expandedMode && ring.buffer && !(state.recording && ring.id === recordingTargetId)) {
    const rotation = -currentPhase(ring) * TAU;
    const rotatedX = x * Math.cos(rotation) - y * Math.sin(rotation);
    const rotatedY = x * Math.sin(rotation) + y * Math.cos(rotation);
    x = rotatedX;
    y = rotatedY;
  }
  if (!state.view3d) {
    return { x: geometry.centerX + x, y: geometry.centerY + y };
  }
  let z = ring.depth * geometry.radius;
  const yaw = state.viewYaw * Math.PI / 180;
  const yawX = x * Math.cos(yaw) + z * Math.sin(yaw);
  const yawZ = -x * Math.sin(yaw) + z * Math.cos(yaw);
  const tilt = state.viewTilt * Math.PI / 180;
  const tiltedY = y * Math.cos(tilt) - yawZ * Math.sin(tilt);
  const tiltedZ = y * Math.sin(tilt) + yawZ * Math.cos(tilt);
  const camera = Math.max(cssWidth, cssHeight) * 1.8;
  const perspective = clamp(
    camera / Math.max(camera * 0.4, camera + tiltedZ),
    0.55,
    1.8,
  );
  return {
    x: geometry.centerX + yawX * perspective,
    y: geometry.centerY + tiltedY * perspective,
  };
}

function ringPoint(ring, phase, geometry, envelope, edge = "center") {
  const scale = geometry.radius * ringScale(ring);
  const point = expandedMode
    ? { ...radialPointAt(ring, phase), tangent: { x: 1, y: 0 } }
    : pointOnContour(ring.vertices, phase);
  let radialX = point.x;
  let radialY = point.y;
  let radialLength = Math.hypot(radialX, radialY);
  if (radialLength < 1e-6) {
    radialX = -point.tangent.y;
    radialY = point.tangent.x;
    radialLength = 1;
  }
  let amplitude = 0;
  if (edge === "outer") amplitude = envelopeSample(envelope.maximums, phase);
  else if (edge === "inner") amplitude = envelopeSample(envelope.minimums, phase);
  const waveformOffset = amplitude * geometry.radius * 0.18;
  return projectRingPoint(
    point.x * scale + radialX / radialLength * waveformOffset,
    point.y * scale + radialY / radialLength * waveformOffset,
    ring,
    geometry,
  );
}

function traceRing(ring, geometry, envelope, edge = "center") {
  context.beginPath();
  for (let index = 0; index <= DRAW_SAMPLES; index += 1) {
    const point = ringPoint(ring, index / DRAW_SAMPLES, geometry, envelope, edge);
    if (index) context.lineTo(point.x, point.y);
    else context.moveTo(point.x, point.y);
  }
  context.closePath();
}

function drawGuideField(geometry) {
  context.save();
  context.strokeStyle = "rgba(214,232,226,.08)";
  context.lineWidth = 1;
  context.setLineDash([3, 8]);
  context.beginPath();
  context.moveTo(geometry.centerX - geometry.radius * 1.7, geometry.centerY);
  context.lineTo(geometry.centerX + geometry.radius * 1.7, geometry.centerY);
  context.moveTo(geometry.centerX, geometry.centerY - geometry.radius * 1.7);
  context.lineTo(geometry.centerX, geometry.centerY + geometry.radius * 1.7);
  context.stroke();
  context.restore();
}

function drawRing(ring, geometry, envelope) {
  const recordingThisRing = state.recording && ring.id === recordingTargetId;
  const hasSignal = recordingThisRing || ring.buffer;
  const selected = ring.id === state.activeRingId;
  context.save();
  context.globalAlpha = !ringIsAudible(ring) ? 0.24 : selected ? 1 : hasSignal ? 0.52 : 0.32;

  traceRing(ring, geometry, envelope, "outer");
  context.fillStyle = colorWithAlpha(ring.color, hasSignal ? 0.07 : 0.02);
  context.fill();
  if (!hasSignal || !ringIsAudible(ring)) context.setLineDash([4, 8]);
  context.strokeStyle = colorWithAlpha(ring.color, hasSignal ? 0.92 : 0.48);
  context.lineWidth = selected ? 1.6 : 1;
  context.shadowColor = colorWithAlpha(ring.color, 0.35);
  context.shadowBlur = hasSignal ? 10 : 4;
  context.stroke();

  context.shadowBlur = 0;
  context.setLineDash([]);
  traceRing(ring, geometry, envelope, "inner");
  context.strokeStyle = colorWithAlpha(ring.color, 0.38);
  context.lineWidth = 0.8;
  context.stroke();
  context.restore();
}

function drawReadHead(ring, geometry, envelope) {
  if (!ring.buffer || !ringIsAudible(ring) || (state.recording && ring.id === recordingTargetId)) return;
  const point = ringPoint(ring, currentPhase(ring), geometry, envelope, "center");
  context.save();
  context.shadowColor = ring.color;
  context.shadowBlur = 13;
  context.fillStyle = "#fff3d6";
  context.beginPath();
  context.arc(point.x, point.y, 4.5, 0, TAU);
  context.fill();
  context.strokeStyle = ring.color;
  context.lineWidth = 1;
  context.stroke();
  context.restore();
}

function vertexScreenPoint(ring, index, geometry) {
  const vertex = expandedMode
    ? radialPointAt(ring, index / ring.radialOffsets.length)
    : ring.vertices[index];
  const scale = geometry.radius * ringScale(ring);
  return projectRingPoint(vertex.x * scale, vertex.y * scale, ring, geometry);
}

function drawVertices(ring, geometry) {
  if (ring.id !== state.activeRingId || state.recording) return;
  context.save();
  for (let index = 0; index < ringVertexCount(ring); index += 1) {
    const point = vertexScreenPoint(ring, index, geometry);
    const selected = index === ring.selectedVertex;
    const hovered = index === hoverVertex;
    context.beginPath();
    context.arc(point.x, point.y, selected ? 7 : hovered ? 6 : 4, 0, TAU);
    context.fillStyle = selected || hovered ? "#fff3d6" : colorWithAlpha(ring.color, 0.3);
    context.fill();
    context.strokeStyle = ring.color;
    context.lineWidth = selected ? 1.5 : 1;
    context.stroke();
  }
  context.restore();
}

function drawCenter(geometry) {
  const ring = activeRing();
  const ordinal = ringOrdinal(ring);
  const recordedSeconds = recordingSampleCount / Math.max(1, recordingSampleRate);
  const headline = state.recording && ring.id === recordingTargetId
    ? "RECORDING"
    : ring.buffer ? `RING ${ordinal}` : `EMPTY RING ${ordinal}`;
  const detail = state.recording && ring.id === recordingTargetId
    ? `${recordedSeconds.toFixed(1)} S`
    : ring.buffer ? `${ring.direction > 0 ? "FORWARD" : "REVERSE"} · ${state.playing ? "PLAYING" : "PAUSED"}` : "PRESS RECORD";
  context.save();
  context.textAlign = "center";
  context.textBaseline = "middle";
  context.font = `500 12px ${CANVAS_FONT}`;
  context.fillStyle = state.recording ? "#ff826f" : "#dbe4e0";
  context.fillText(headline, geometry.centerX, geometry.centerY - 6);
  context.font = `9px ${CANVAS_FONT}`;
  context.fillStyle = "rgba(119,131,126,.95)";
  context.fillText(detail, geometry.centerX, geometry.centerY + 12);
  context.beginPath();
  context.arc(geometry.centerX, geometry.centerY, 2.5, 0, TAU);
  context.fillStyle = ring.color;
  context.fill();
  context.restore();
}

function drawFrame() {
  context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
  context.clearRect(0, 0, cssWidth, cssHeight);
  const geometry = stageGeometry();
  drawGuideField(geometry);
  const active = activeRing();
  const rings = [...orderedRings().filter((ring) => ring.id !== active.id), active];
  for (const ring of rings) {
    const envelope = activeEnvelope(ring);
    drawRing(ring, geometry, envelope);
    drawReadHead(ring, geometry, envelope);
    drawVertices(ring, geometry);
  }
  drawCenter(geometry);
}

function frame(now) {
  scheduledFrame = 0;
  drawFrame();
  if (state.recording || state.playing || pointerGesture || now - lastUiUpdate > 100) {
    updateUi();
    lastUiUpdate = now;
  }
  if (state.recording || state.playing || pointerGesture) scheduleFrame();
}

function pointerData(event) {
  const bounds = canvas.getBoundingClientRect();
  return {
    x: (event.clientX - bounds.left) * cssWidth / Math.max(1, bounds.width),
    y: (event.clientY - bounds.top) * cssHeight / Math.max(1, bounds.height),
    geometry: stageGeometry(),
  };
}

function nearestVertex(data, ring, geometry) {
  let selected = -1;
  let distance = 22;
  for (let index = 0; index < ringVertexCount(ring); index += 1) {
    const point = vertexScreenPoint(ring, index, geometry);
    const nextDistance = Math.hypot(data.x - point.x, data.y - point.y);
    if (nextDistance < distance) {
      selected = index;
      distance = nextDistance;
    }
  }
  return selected;
}

function distanceToSegment(point, start, end) {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const lengthSquared = dx * dx + dy * dy;
  const amount = lengthSquared <= 1e-9
    ? 0
    : clamp(((point.x - start.x) * dx + (point.y - start.y) * dy) / lengthSquared, 0, 1);
  return Math.hypot(
    point.x - (start.x + dx * amount),
    point.y - (start.y + dy * amount),
  );
}

function nearestProjectedContourPhase(data, ring, geometry) {
  const envelope = activeEnvelope(ring);
  const samples = 128;
  let bestPhase = 0;
  let bestDistance = Infinity;
  let previous = ringPoint(ring, 0, geometry, envelope, "center");
  for (let index = 1; index <= samples; index += 1) {
    const phase = index / samples;
    const point = ringPoint(ring, phase, geometry, envelope, "center");
    const distance = distanceToSegment(data, previous, point);
    if (distance < bestDistance) {
      bestDistance = distance;
      bestPhase = wrap01((index - 0.5) / samples);
    }
    previous = point;
  }
  return { phase: bestPhase, distance: bestDistance };
}

function nearestRingHit(data) {
  let selected = null;
  let selectedPhase = 0;
  let selectedDistance = 28;
  for (const ring of state.rings) {
    const hit = nearestProjectedContourPhase(data, ring, data.geometry);
    if (hit.distance < selectedDistance) {
      selected = ring;
      selectedPhase = hit.phase;
      selectedDistance = hit.distance;
    }
  }
  return selected ? { ring: selected, phase: selectedPhase } : null;
}

canvas.addEventListener("pointerdown", (event) => {
  if (event.isPrimary === false || (event.button ?? 0) !== 0 || state.recording || recordChanging) return;
  canvas.focus({ preventScroll: true });
  const data = pointerData(event);
  let ring = activeRing();
  let vertexIndex = nearestVertex(data, ring, data.geometry);
  if (vertexIndex < 0) {
    const hit = nearestRingHit(data);
    if (!hit) return;
    ring = hit.ring;
    setActiveRing(ring, false);
    vertexIndex = nearestVertex(data, ring, data.geometry);
  }
  ring.selectedVertex = vertexIndex >= 0 ? vertexIndex : ring.selectedVertex;
  if (vertexIndex >= 0) {
    if (expandedMode && ring.buffer) {
      captureRingPhase(ring);
      stopRingSource(ring);
      state.scrubbing = true;
    }
    pointerGesture = {
      type: "vertex",
      pointerId: event.pointerId,
      ringId: ring.id,
      vertexIndex,
      startPointer: { x: data.x, y: data.y },
      startVertex: expandedMode ? null : { ...ring.vertices[vertexIndex] },
      startOffset: expandedMode ? ring.radialOffsets[vertexIndex] : 0,
      startDistance: Math.hypot(
        data.x - data.geometry.centerX,
        data.y - data.geometry.centerY,
      ),
      visualRotation: expandedMode && ring.buffer ? -ring.phase * TAU : 0,
    };
    stageWrap.classList.add("is-deforming");
  } else {
    const hit = nearestProjectedContourPhase(data, ring, data.geometry);
    captureRingPhase(ring);
    stopRingSource(ring);
    ring.lastScrubAt = -Infinity;
    state.scrubbing = true;
    pointerGesture = {
      type: "scrub",
      pointerId: event.pointerId,
      ringId: ring.id,
      previousPhase: hit.phase,
      startPhase: ring.phase,
      lastPointerAngle: Math.atan2(
        data.y - data.geometry.centerY,
        data.x - data.geometry.centerX,
      ),
      accumulatedAngle: 0,
      lastMoveAt: performance.now(),
    };
    stageWrap.classList.add("is-spinning");
  }
  canvas.setPointerCapture(event.pointerId);
  scheduleFrame();
  event.preventDefault();
});

canvas.addEventListener("pointermove", (event) => {
  const data = pointerData(event);
  if (!pointerGesture || event.pointerId !== pointerGesture.pointerId) {
    hoverVertex = state.recording ? -1 : nearestVertex(data, activeRing(), data.geometry);
    canvas.style.cursor = hoverVertex >= 0 ? "move" : nearestRingHit(data) ? "grab" : "";
    scheduleFrame();
    return;
  }
  const ring = ringById(pointerGesture.ringId);
  if (!ring) return;
  if (pointerGesture.type === "vertex") {
    const scale = data.geometry.radius * ringScale(ring);
    if (expandedMode) {
      const distance = Math.hypot(
        data.x - data.geometry.centerX,
        data.y - data.geometry.centerY,
      );
      ring.radialOffsets[pointerGesture.vertexIndex] = clamp(
        pointerGesture.startOffset
          + (distance - pointerGesture.startDistance) / Math.max(1, scale),
        MIN_RADIAL_OFFSET,
        MAX_RADIAL_OFFSET,
      );
    } else {
      const yawScale = state.view3d ? Math.max(0.25, Math.cos(state.viewYaw * Math.PI / 180)) : 1;
      const tiltScale = state.view3d ? Math.max(0.25, Math.cos(state.viewTilt * Math.PI / 180)) : 1;
      const screenX = (data.x - pointerGesture.startPointer.x) / Math.max(1, scale * yawScale);
      const screenY = (data.y - pointerGesture.startPointer.y) / Math.max(1, scale * tiltScale);
      const rotation = pointerGesture.visualRotation ?? 0;
      const localX = screenX * Math.cos(rotation) + screenY * Math.sin(rotation);
      const localY = -screenX * Math.sin(rotation) + screenY * Math.cos(rotation);
      ring.vertices = moveVertex(ring.vertices, pointerGesture.vertexIndex, {
        x: pointerGesture.startVertex.x + localX,
        y: pointerGesture.startVertex.y + localY,
      });
    }
    ring.preset = "custom";
  } else {
    const now = performance.now();
    let delta;
    if (expandedMode) {
      const angle = Math.atan2(
        data.y - data.geometry.centerY,
        data.x - data.geometry.centerX,
      );
      const angleDelta = Math.atan2(
        Math.sin(angle - pointerGesture.lastPointerAngle),
        Math.cos(angle - pointerGesture.lastPointerAngle),
      );
      pointerGesture.accumulatedAngle += angleDelta;
      pointerGesture.lastPointerAngle = angle;
      delta = -angleDelta / TAU;
      ring.phase = scrubPhaseFromAngle(
        pointerGesture.startPhase,
        pointerGesture.accumulatedAngle,
      );
    } else {
      const hit = nearestProjectedContourPhase(data, ring, data.geometry);
      delta = hit.phase - pointerGesture.previousPhase;
      if (delta > 0.5) delta -= 1;
      if (delta < -0.5) delta += 1;
      ring.phase = hit.phase;
      pointerGesture.previousPhase = hit.phase;
    }
    if (Math.abs(delta) > 0.0005) ring.direction = delta < 0 ? -1 : 1;
    const scrubRate = scrubRateFromMotion(
      delta,
      ring.duration,
      now - pointerGesture.lastMoveAt,
    );
    pointerGesture.lastMoveAt = now;
    anchorRing(ring, ring.phase);
    playScrubGrain(ring, scrubRate);
  }
  updateUi();
  scheduleFrame();
  event.preventDefault();
});

function finishPointerGesture(event, announceResult = true) {
  if (!pointerGesture || event?.pointerId !== undefined && event.pointerId !== pointerGesture.pointerId) return;
  const gesture = pointerGesture;
  const ring = ringById(gesture.ringId);
  pointerGesture = null;
  stageWrap.classList.remove("is-deforming", "is-spinning");
  canvas.style.cursor = "";
  if (ring && gesture.type === "scrub") {
    stopScrubVoice(ring);
    state.scrubbing = false;
    if (state.playing) startRingSource(ring);
    if (announceResult) announce(`Ring ${ringOrdinal(ring)} scrubbed ${ring.direction < 0 ? "in reverse" : "forward"}.`);
  } else if (ring) {
    if (ring.rawSamples && ring.timeStretch > 0) {
      rebuildRingAudio(ring, { restart: !expandedMode });
    }
    if (expandedMode && ring.buffer) {
      state.scrubbing = false;
      if (state.playing) startRingSource(ring);
    }
    if (announceResult) announce("Vertex moved freely in two dimensions.");
  }
  updateUi();
  scheduleFrame();
}

canvas.addEventListener("pointerup", (event) => finishPointerGesture(event));
canvas.addEventListener("pointercancel", (event) => finishPointerGesture(event, false));
canvas.addEventListener("lostpointercapture", (event) => finishPointerGesture(event, false));
canvas.addEventListener("pointerleave", () => {
  if (pointerGesture) return;
  hoverVertex = -1;
  canvas.style.cursor = "";
  scheduleFrame();
});

$("recordButton").addEventListener("click", () => {
  void (state.recording ? finishRecording() : beginRecording({ replace: false }));
});
$("replaceRing").addEventListener("click", () => {
  void beginRecording({ replace: true });
});
$("playButton").addEventListener("click", () => void setPlaying(!state.playing));
$("audioButton").addEventListener("click", () => void toggleAudio());
$("clearAllRings").addEventListener("click", clearAllRings);
$("ringList").addEventListener("click", (event) => {
  const button = event.target.closest?.("[data-ring-action]");
  if (!button || button.disabled) return;
  const ring = ringById(Number(button.dataset.ringId));
  if (!ring) return;
  if (button.dataset.ringAction === "select") setActiveRing(ring);
  else if (button.dataset.ringAction === "mute") setRingMuted(ring, !ring.muted);
  else if (button.dataset.ringAction === "solo") toggleRingSolo(ring);
  else if (button.dataset.ringAction === "delete") removeRing(ring);
});

for (const button of $("shapePreset").querySelectorAll("button")) {
  button.addEventListener("click", () => applyPreset(button.dataset.value));
}
for (const button of $("ringDirection").querySelectorAll("button")) {
  button.addEventListener("click", () => setDirection(Number(button.dataset.value)));
}
for (const button of $("recordBacking").querySelectorAll("button")) {
  button.addEventListener("click", () => {
    state.backingDuringRecord = button.dataset.value === "on";
    persistSettings();
    updateUi();
    announce(state.backingDuringRecord
      ? "Existing rings may play during recording. Use headphones."
      : "Existing rings will pause during recording.");
  });
}
for (const button of $("timeMode").querySelectorAll("button")) {
  button.addEventListener("click", () => setTimeMode(button.dataset.value));
}
$("timeStretch").addEventListener("input", () => {
  activeRing().timeStretch = clamp(Number($("timeStretch").value), 0, 1);
  updateUi();
});
$("timeStretch").addEventListener("change", () => {
  setTimeStretch($("timeStretch").value);
});
$("pitchShift").addEventListener("input", () => {
  setPitchSemitones($("pitchShift").value);
});
for (const button of $("viewMode").querySelectorAll("button")) {
  button.addEventListener("click", () => setThreeDView(button.dataset.value === "3d"));
}
$("viewTilt").addEventListener("input", () => {
  state.viewTilt = clamp(Number($("viewTilt").value), 0, 78);
  updateUi();
  scheduleFrame();
});
$("viewYaw").addEventListener("input", () => {
  state.viewYaw = clamp(Number($("viewYaw").value), -80, 80);
  updateUi();
  scheduleFrame();
});
$("ringDepth").addEventListener("input", () => {
  activeRing().depth = clamp(Number($("ringDepth").value), -1, 1);
  updateUi();
  scheduleFrame();
});
$("spreadDepth").addEventListener("click", spreadRingDepths);
$("addVertex").addEventListener("click", addVertex);
$("removeVertex").addEventListener("click", removeVertex);
$("resetShape").addEventListener("click", () => applyPreset("circle"));
$("level").addEventListener("input", () => {
  state.level = clamp(Number($("level").value), 0, 1);
  persistSettings();
  paintMasterGain();
  updateUi();
});

window.addEventListener("keydown", (event) => {
  const tag = event.target?.tagName;
  if (tag && /^(INPUT|SELECT|TEXTAREA|BUTTON|SUMMARY|A)$/.test(tag)) return;
  if (event.ctrlKey || event.metaKey || event.altKey) return;
  if (event.repeat && (event.code === "Space" || event.code === "KeyR")) return;
  if (event.code === "Space") {
    event.preventDefault();
    void setPlaying(!state.playing);
  } else if (event.code === "KeyR") {
    event.preventDefault();
    void (state.recording ? finishRecording() : beginRecording({ replace: false }));
  } else if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
    event.preventDefault();
    if (event.shiftKey && activeRing().buffer) {
      const ring = activeRing();
      ring.phase = wrap01(currentPhase(ring) + (event.key === "ArrowLeft" ? -0.02 : 0.02));
      anchorRing(ring, ring.phase);
      if (state.playing) startRingSource(ring);
    } else {
      setDirection(event.key === "ArrowLeft" ? -1 : 1);
    }
  }
});

document.addEventListener("visibilitychange", () => {
  if (document.hidden) {
    captureGeneration += 1;
    if (state.recording) void finishRecording({ playAfterCapture: false });
    finishPointerGesture(undefined, false);
    if (audioContext) {
      masterGain?.gain.setValueAtTime(0, audioContext.currentTime);
      void audioContext.suspend();
    }
    return;
  }
  if (!audioContext) return;
  void audioContext.resume().then(() => {
    for (const ring of recordedRings()) captureRingPhase(ring);
    paintMasterGain();
    scheduleFrame();
  }).catch(() => {
    // A later transport gesture can resume audio.
  });
});

window.addEventListener("pagehide", () => {
  captureGeneration += 1;
  transportGeneration += 1;
  recordChanging = false;
  finishPointerGesture(undefined, false);
  state.audio = false;
  state.recording = false;
  state.playing = false;
  releaseCapture();
  recordingChunks = [];
  recordingSampleCount = 0;
  liveSamples = new Float32Array(0);
  recordingSession = null;
  recordingTargetId = null;
  stopAllRingSources({ capturePhase: false });
  if (audioContext?.state !== "closed") void audioContext.close();
});
window.addEventListener("pageshow", () => {
  updateUi();
  scheduleFrame();
});

new ResizeObserver(resizeCanvas).observe(stageWrap);
updateUi();
resizeCanvas();

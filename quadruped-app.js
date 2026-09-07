import {
  QUADRUPED_ANIMALS,
  QUADRUPED_LANES,
  QUADRUPED_LIMITS,
  QUADRUPED_STEP_COUNT,
  QUADRUPED_TERRAINS,
  applyQuadrupedAnimal,
  applyQuadrupedBehavior,
  clearQuadrupedPattern,
  createQuadrupedState,
  cycleQuadrupedContact,
  cycleQuadrupedTerrain,
  deriveQuadrupedPose,
  describeQuadrupedStep,
  mutateQuadrupedPattern,
  quadrupedAnimal,
  quadrupedBehavior,
  quadrupedBehaviorFit,
  quadrupedBehaviorsForAnimal,
  quadrupedFootVoice,
  quadrupedHeadPhrase,
  quadrupedSequenceEvent,
  quadrupedTerrain,
  sanitizeQuadrupedState,
  setQuadrupedContact,
} from "./src/quadruped.js";
import {
  advanceQuadrupedMotor,
  createQuadrupedMotorState,
  kickQuadrupedMotor,
  predictQuadrupedMotor,
  quadrupedMotorSnapshot,
} from "./src/quadruped-motor.js";
import { connectAudioOutput } from "./src/audio-output-manager.js";
import { unlockAudioContext } from "./src/audio.js";

const $ = (id) => document.getElementById(id);
const canvas = $("stage");
const stageWrap = $("stageWrap");
const drawing = canvas.getContext("2d", { alpha: false, desynchronized: true });
const AUDIO_OFF_MESSAGE = "Audio is off — turn it on to hear playback";
const compactMedia = globalThis.matchMedia?.("(max-width: 720px), (pointer: coarse)");
const reducedMotion = globalThis.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches ?? false;
const laneById = new Map(QUADRUPED_LANES.map((lane, index) => [lane.id, { ...lane, index }]));
const terrainById = new Map(QUADRUPED_TERRAINS.map((terrain) => [terrain.id, terrain]));
const lanePan = Object.freeze({
  "front-left": -0.5,
  "front-right": 0.5,
  "rear-left": -0.3,
  "rear-right": 0.3,
  tail: 0.18,
});

let state = createQuadrupedState("elephant");
let selectedStep = 0;
let transportPlaying = false;
let stoppedPosition = 0;
let motor = createQuadrupedMotorState(state);
let motorPerformance = performance.now();
let lastMotorPresentation = "";
let nextScheduledOrdinal = null;
let schedulerTimer = 0;
let graph = null;
let audioStarting = null;
let pageActive = true;
let stageVisible = true;
let animationFrame = 0;
let lastPaintTime = -Infinity;
let lastPlayingStep = -1;
let lastReadoutStep = -1;
let lastManualHeadAudioTime = -Infinity;
let headReadoutPerformanceActive = false;
let canvasMetrics = Object.freeze({ width: 1, height: 1, dpr: 1 });
let canvasPointer = null;
let lastAnimalBounds = null;
let lastTerrainHits = [];
const activeSources = new Set();
const manualImpulses = new Map();
const modeMemory = new Map();
const gridControls = [];
const cabinetFrames = [];
const laneLabelElements = new Map();
const uiTimers = new Set();
let behaviorButtonAnimalId = "";

function clamp(value, minimum = 0, maximum = 1) {
  const number = Number(value);
  return Math.min(maximum, Math.max(minimum, Number.isFinite(number) ? number : minimum));
}

function lerp(start, end, amount) {
  return start + (end - start) * clamp(amount);
}

function mod(value, divisor) {
  return ((value % divisor) + divisor) % divisor;
}

function setOutput(element, value) {
  if (!element) return;
  element.value = value;
  element.textContent = value;
}

function announce(message) {
  const live = $("liveStatus");
  if (!live) return;
  live.textContent = "";
  requestAnimationFrame(() => {
    if (pageActive) live.textContent = message;
  });
}

function modeKey(source = state) {
  return `${source.animalId}:${source.behaviorId}`;
}

function rememberMode() {
  modeMemory.set(modeKey(), sanitizeQuadrupedState(state));
}

function materializeMotor(now = performance.now()) {
  const safeNow = Number.isFinite(Number(now)) ? Number(now) : performance.now();
  if (!transportPlaying) {
    motorPerformance = safeNow;
    return quadrupedMotorSnapshot(state, motor);
  }
  const deltaSeconds = clamp((safeNow - motorPerformance) / 1_000, 0, 2);
  if (deltaSeconds > 0) motor = advanceQuadrupedMotor(state, motor, deltaSeconds).motor;
  motorPerformance = safeNow;
  stoppedPosition = motor.position;
  return quadrupedMotorSnapshot(state, motor);
}

function currentPosition(now = performance.now()) {
  return transportPlaying ? materializeMotor(now).position : stoppedPosition;
}

function retimeTransport(position, now = performance.now(), { preserveMotion = false } = {}) {
  const safePosition = Math.max(0, Number(position) || 0);
  stoppedPosition = safePosition;
  const options = preserveMotion
    ? { ...motor, position: safePosition }
    : { position: safePosition };
  motor = createQuadrupedMotorState(state, options);
  motorPerformance = now;
}

function footfallEnergyAtStep(score, step) {
  const safeStep = mod(Math.trunc(step), QUADRUPED_STEP_COUNT);
  return QUADRUPED_LANES.reduce((total, lane) => (
    lane.id === "tail" ? total : total + (score.pattern?.[lane.id]?.[safeStep] ?? 0)
  ), 0);
}

function nextFootfallPosition(position, preferredStep = null) {
  const safePosition = Math.max(0, Number(position) || 0);
  if (preferredStep !== null && footfallEnergyAtStep(state, preferredStep) > 0) {
    let candidate = Math.floor(safePosition / QUADRUPED_STEP_COUNT) * QUADRUPED_STEP_COUNT
      + mod(Math.trunc(preferredStep), QUADRUPED_STEP_COUNT);
    if (candidate < safePosition - 0.001) candidate += QUADRUPED_STEP_COUNT;
    return candidate;
  }
  const firstOrdinal = Math.ceil(safePosition - 0.001);
  for (let offset = 0; offset < QUADRUPED_STEP_COUNT; offset += 1) {
    const candidate = firstOrdinal + offset;
    if (footfallEnergyAtStep(state, candidate) > 0) return candidate;
  }
  return null;
}

function wakeMotorAtFootfall(now = performance.now(), preferredStep = null, strength = 1) {
  const footfallPosition = nextFootfallPosition(motor.position, preferredStep);
  if (footfallPosition === null) return false;
  retimeTransport(footfallPosition, now);
  motor = kickQuadrupedMotor(state, motor, strength);
  stoppedPosition = motor.position;
  return motor.velocity > 0.012;
}

function setAudioPresentation(status = "off", message = "") {
  const button = $("audioButton");
  const on = status === "on";
  button.setAttribute("aria-pressed", String(on));
  button.dataset.audioState = status;
  button.disabled = status === "starting";
  const action = on ? "Turn audio off" : "Turn audio on";
  button.setAttribute("aria-label", status === "starting" ? "Audio starting" : action);
  button.title = status === "starting" ? "Audio starting" : action;
  setOutput($("audioState"), on ? "on" : "off");
  const error = $("audioError");
  error.hidden = !message;
  error.textContent = message;
  syncTransportHint();
}

function isAudioOn() {
  return Boolean(graph && $("audioButton")?.getAttribute("aria-pressed") === "true");
}

function syncTransportHint() {
  const hint = $("transportHint");
  if (!hint) return;
  hint.hidden = !(transportPlaying && !isAudioOn());
}

function createNoiseBuffer(context) {
  const frames = Math.ceil(context.sampleRate * 1.25);
  const buffer = context.createBuffer(1, frames, context.sampleRate);
  const channel = buffer.getChannelData(0);
  let seed = 0x71756164;
  let previous = 0;
  for (let index = 0; index < frames; index += 1) {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    const white = seed / 0x1_0000_0000 * 2 - 1;
    previous = previous * 0.12 + white * 0.88;
    channel[index] = previous;
  }
  return buffer;
}

async function createAudioGraph() {
  const Context = globalThis.AudioContext ?? globalThis.webkitAudioContext;
  if (!Context) throw new Error("This browser does not provide Web Audio.");
  const context = new Context({ latencyHint: "interactive", sampleRate: 48_000 });
  unlockAudioContext(context);
  await context.resume();
  const mixBus = context.createGain();
  const compressor = context.createDynamicsCompressor();
  const masterGain = context.createGain();
  const analyser = context.createAnalyser();
  mixBus.gain.value = 1.45;
  compressor.threshold.value = -18;
  compressor.knee.value = 20;
  compressor.ratio.value = 6;
  compressor.attack.value = 0.002;
  compressor.release.value = 0.12;
  masterGain.gain.value = state.outputLevel;
  analyser.fftSize = 1_024;
  analyser.smoothingTimeConstant = 0.62;
  mixBus.connect(compressor);
  compressor.connect(masterGain);
  masterGain.connect(analyser);
  const releaseOutput = connectAudioOutput(context, analyser, { runtime: globalThis });
  return {
    context,
    mixBus,
    compressor,
    masterGain,
    analyser,
    releaseOutput,
    noiseBuffer: createNoiseBuffer(context),
  };
}

async function ensureAudio() {
  if (graph) {
    unlockAudioContext(graph.context);
    await graph.context.resume();
    setAudioPresentation("on");
    startAudioScheduler();
    return true;
  }
  if (audioStarting) return audioStarting;
  setAudioPresentation("starting");
  audioStarting = (async () => {
    let candidate = null;
    try {
      candidate = await createAudioGraph();
      if (!pageActive) {
        candidate.releaseOutput?.();
        try {
          await candidate.context.close();
        } catch {
          // Teardown may already have closed a partially constructed context.
        }
        return false;
      }
      graph = candidate;
      setAudioPresentation("on");
      if (transportPlaying) resetAudioSchedule();
      announce(transportPlaying
        ? "Quadruped audio joined the moving sequence without restarting it."
        : "Quadruped audio is ready.");
      return true;
    } catch (error) {
      console.error(error);
      candidate?.releaseOutput?.();
      try {
        await candidate?.context?.close?.();
      } catch {
        // A partially constructed graph can already have a closed context.
      }
      graph = null;
      setAudioPresentation("error", error?.message || "Unable to start Quadruped audio.");
      return false;
    } finally {
      audioStarting = null;
    }
  })();
  return audioStarting;
}

function removeAudioSource(record) {
  activeSources.delete(record);
  if (record.disconnected) return;
  record.disconnected = true;
  for (const node of record.nodes) {
    try {
      node.disconnect?.();
    } catch {
      // A closed context may already have detached the node.
    }
  }
}

function cancelAudioSource(record, releaseSeconds = 0.012, { disconnectImmediately = false } = {}) {
  if (!activeSources.has(record)) return;
  const context = record.context ?? graph?.context;
  const now = context?.currentTime ?? 0;
  try {
    record.gain?.gain?.cancelScheduledValues?.(now);
    record.gain?.gain?.setTargetAtTime?.(0.0001, now, Math.max(0.002, releaseSeconds));
    record.source.stop?.(now + (disconnectImmediately ? 0.004 : Math.max(0.012, releaseSeconds * 4)));
  } catch {
    removeAudioSource(record);
    return;
  }
  if (disconnectImmediately) removeAudioSource(record);
}

function evictAudioSource(predicate) {
  const record = [...activeSources].find(predicate);
  if (!record) return false;
  // Overload shedding is intentionally immediate: a bookkeeping-only delete
  // would let disconnected limits hide hundreds of still-connected nodes.
  cancelAudioSource(record, 0.003, { disconnectImmediately: true });
  return true;
}

function registerAudioSource(source, nodes, gain, startTime, endTime, role = "body") {
  if (role.startsWith("head")) {
    while ([...activeSources].filter((record) => record.role?.startsWith("head")).length >= QUADRUPED_LIMITS.maxHeadVoices) {
      if (!evictAudioSource((record) => record.role === "head-ornament")
        && !evictAudioSource((record) => record.role === "head-core")) break;
    }
  }
  while (activeSources.size >= QUADRUPED_LIMITS.maxScheduledVoices) {
    if (evictAudioSource((record) => record.role === "head-ornament")) continue;
    const oldest = activeSources.values().next().value;
    if (!oldest || !evictAudioSource((record) => record === oldest)) break;
  }
  const record = {
    source,
    nodes: [source, ...nodes],
    gain,
    startTime,
    endTime,
    role,
    context: source.context ?? graph?.context ?? null,
  };
  activeSources.add(record);
  source.onended = () => removeAudioSource(record);
  return record;
}

function cancelFutureSources() {
  if (!graph) return;
  const boundary = graph.context.currentTime + 0.012;
  for (const record of [...activeSources]) {
    if (record.startTime > boundary) cancelAudioSource(record, 0.004);
  }
}

function releaseAllSources() {
  for (const record of [...activeSources]) cancelAudioSource(record, 0.01);
}

async function closeAudio({ announceChange = true } = {}) {
  stopAudioScheduler();
  const closing = graph;
  if (!closing) {
    setAudioPresentation("off");
    return;
  }
  releaseAllSources();
  graph = null;
  try {
    closing.releaseOutput?.();
    closing.mixBus.disconnect();
    closing.compressor.disconnect();
    closing.masterGain.disconnect();
    closing.analyser.disconnect();
    await closing.context.close();
  } catch {
    // Teardown remains idempotent when pagehide races a user click.
  }
  activeSources.clear();
  setAudioPresentation("off");
  if (transportPlaying) {
    syncTransportHint();
    if (announceChange) announce(`${AUDIO_OFF_MESSAGE}. The animal keeps moving silently.`);
  } else if (announceChange) {
    announce("Quadruped audio is off.");
  }
}

async function toggleAudio() {
  if (graph) await closeAudio();
  else await ensureAudio();
}

function createPanner(context, pan = 0) {
  if (typeof context.createStereoPanner === "function") {
    const panner = context.createStereoPanner();
    panner.pan.value = clamp(pan, -1, 1);
    return panner;
  }
  return context.createGain();
}

function scheduleTone({
  when,
  frequency,
  duration,
  peak,
  pan = 0,
  type = "sine",
  attack = 0.004,
  startRatio = 1,
  endRatio = 0.94,
  filterType = "lowpass",
  filterFrequency = 4_000,
  filterQ = 0.7,
  role = "body",
}) {
  if (!graph || !Number.isFinite(when)) return null;
  const { context, mixBus } = graph;
  const start = Math.max(context.currentTime + 0.004, when);
  const end = start + clamp(duration, 0.025, 1.4);
  const oscillator = context.createOscillator();
  const gain = context.createGain();
  const filter = context.createBiquadFilter();
  const panner = createPanner(context, pan);
  oscillator.type = type;
  oscillator.frequency.setValueAtTime(clamp(frequency * startRatio, 20, 18_000), start);
  oscillator.frequency.exponentialRampToValueAtTime(clamp(frequency * endRatio, 20, 18_000), end);
  gain.gain.setValueAtTime(0.0001, start);
  gain.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak), start + Math.min(attack, duration * 0.35));
  gain.gain.exponentialRampToValueAtTime(0.0001, end);
  filter.type = filterType;
  filter.frequency.value = clamp(filterFrequency, 30, 19_000);
  filter.Q.value = clamp(filterQ, 0.01, 18);
  oscillator.connect(gain);
  gain.connect(filter);
  filter.connect(panner);
  panner.connect(mixBus);
  registerAudioSource(oscillator, [gain, filter, panner], gain, start, end, role);
  oscillator.start(start);
  oscillator.stop(end + 0.02);
  return oscillator;
}

function scheduleNoise({
  when,
  duration,
  peak,
  pan = 0,
  filterType = "bandpass",
  filterFrequency = 900,
  filterQ = 0.8,
  offset = 0,
  role = "body",
}) {
  if (!graph || !Number.isFinite(when)) return null;
  const { context, mixBus, noiseBuffer } = graph;
  const start = Math.max(context.currentTime + 0.004, when);
  const safeDuration = clamp(duration, 0.018, 0.48);
  const end = start + safeDuration;
  const source = context.createBufferSource();
  const filter = context.createBiquadFilter();
  const gain = context.createGain();
  const panner = createPanner(context, pan);
  source.buffer = noiseBuffer;
  filter.type = filterType;
  filter.frequency.value = clamp(filterFrequency, 40, 18_000);
  filter.Q.value = clamp(filterQ, 0.01, 18);
  gain.gain.setValueAtTime(0.0001, start);
  gain.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak), start + Math.min(0.004, safeDuration * 0.18));
  gain.gain.exponentialRampToValueAtTime(0.0001, end);
  source.connect(filter);
  filter.connect(gain);
  gain.connect(panner);
  panner.connect(mixBus);
  registerAudioSource(source, [filter, gain, panner], gain, start, end, role);
  source.start(start, mod(offset, 0.72), safeDuration);
  source.stop(end + 0.015);
  return source;
}

function midiToFrequency(note) {
  return 440 * (2 ** ((Number(note) - 69) / 12));
}

function schedulePitchContour({
  when,
  notes,
  offsets,
  duration,
  peak,
  pan = 0,
  type = "sawtooth",
  attack = 0.04,
  filterFrequency = 1_800,
  filterQ = 0.7,
  octaveOffset = 0,
  role = "head-core",
}) {
  if (!graph || !Number.isFinite(when)) return null;
  const safeNotes = (Array.isArray(notes) ? notes : [])
    .map((note) => Number(note) + octaveOffset)
    .filter(Number.isFinite)
    .slice(0, 6);
  if (!safeNotes.length) return null;
  const { context, mixBus } = graph;
  const safeDuration = clamp(duration, 0.08, 1.4);
  const start = Math.max(context.currentTime + 0.004, when);
  const end = start + safeDuration;
  const oscillator = context.createOscillator();
  const gain = context.createGain();
  const filter = context.createBiquadFilter();
  const panner = createPanner(context, pan);
  oscillator.type = type;
  oscillator.frequency.setValueAtTime(clamp(midiToFrequency(safeNotes[0]), 20, 18_000), start);
  for (let index = 1; index < safeNotes.length; index += 1) {
    const requestedOffset = Number(offsets?.[index]);
    const fallbackOffset = safeDuration * index / Math.max(1, safeNotes.length - 1);
    const offset = clamp(Number.isFinite(requestedOffset) ? requestedOffset : fallbackOffset, 0.004, safeDuration);
    oscillator.frequency.linearRampToValueAtTime(clamp(midiToFrequency(safeNotes[index]), 20, 18_000), start + offset);
  }
  gain.gain.setValueAtTime(0.0001, start);
  gain.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak), start + Math.min(attack, safeDuration * 0.28));
  gain.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak * 0.72), start + safeDuration * 0.72);
  gain.gain.exponentialRampToValueAtTime(0.0001, end);
  filter.type = "bandpass";
  filter.frequency.value = clamp(filterFrequency, 80, 18_000);
  filter.Q.value = clamp(filterQ, 0.01, 18);
  oscillator.connect(gain);
  gain.connect(filter);
  filter.connect(panner);
  panner.connect(mixBus);
  registerAudioSource(oscillator, [gain, filter, panner], gain, start, end, role);
  oscillator.start(start);
  oscillator.stop(end + 0.02);
  return oscillator;
}

function scheduleTail(contact, terrain, when, normalization, absoluteStep) {
  const amount = contact.intensity * normalization;
  const pan = lanePan.tail;
  if (state.animalId === "elephant") {
    scheduleNoise({ when, duration: 0.09 + terrain.decay * 0.08, peak: 0.11 * amount, pan, filterType: "bandpass", filterFrequency: 480 + terrain.brightness * 1_100, filterQ: 1.1, offset: absoluteStep * 0.071 });
    scheduleTone({ when, frequency: 118 * (2 ** (terrain.pitchOffset / 24)), duration: 0.12 + terrain.decay * 0.16, peak: 0.085 * amount, pan, type: "triangle", startRatio: 1.5, endRatio: 0.82, filterFrequency: 1_200 });
  } else if (state.animalId === "unicorn") {
    for (let index = 0; index < 3; index += 1) {
      scheduleTone({ when: when + index * 0.003, frequency: 720 * (2 ** ((terrain.pitchOffset + index * 7) / 12)), duration: 0.18 + terrain.decay * 0.3, peak: 0.045 * amount, pan: pan + (index - 1) * 0.18, type: "sine", startRatio: 1.02, endRatio: 0.99, filterType: "bandpass", filterFrequency: 2_400 + index * 1_200, filterQ: 0.8 });
    }
  } else if (state.animalId === "gazelle") {
    scheduleNoise({ when, duration: 0.055 + terrain.decay * 0.05, peak: 0.085 * amount, pan, filterType: "highpass", filterFrequency: 2_200 + terrain.brightness * 2_600, filterQ: 0.5, offset: absoluteStep * 0.053 });
    scheduleTone({ when, frequency: 310 * (2 ** (terrain.pitchOffset / 12)), duration: 0.07 + terrain.decay * 0.08, peak: 0.05 * amount, pan, type: "triangle", startRatio: 1.12, endRatio: 0.96, filterFrequency: 2_800 });
  } else if (state.animalId === "cat") {
    scheduleNoise({ when, duration: 0.12 + terrain.decay * 0.12, peak: 0.062 * amount, pan, filterType: "lowpass", filterFrequency: 680 + terrain.brightness * 1_100, filterQ: 0.7, offset: absoluteStep * 0.041 });
    scheduleTone({ when, frequency: 92 * (2 ** (terrain.pitchOffset / 24)), duration: 0.16, peak: 0.042 * amount, pan, type: "sine", startRatio: 1.04, endRatio: 0.97, filterFrequency: 520 });
  } else if (state.animalId === "cheetah") {
    scheduleNoise({ when, duration: 0.035 + terrain.decay * 0.035, peak: 0.105 * amount, pan, filterType: "highpass", filterFrequency: 3_100 + terrain.brightness * 3_200, filterQ: 0.72, offset: absoluteStep * 0.067 });
    scheduleTone({ when: when + 0.002, frequency: 470 * (2 ** (terrain.pitchOffset / 12)), duration: 0.045, peak: 0.062 * amount, pan, type: "square", startRatio: 1.26, endRatio: 0.78, filterType: "bandpass", filterFrequency: 2_900, filterQ: 1.5 });
  } else if (state.animalId === "giraffe") {
    scheduleNoise({ when, duration: 0.1 + terrain.decay * 0.11, peak: 0.068 * amount, pan, filterType: "bandpass", filterFrequency: 920 + terrain.brightness * 1_300, filterQ: 0.9, offset: absoluteStep * 0.037 });
    scheduleTone({ when, frequency: 164 * (2 ** (terrain.pitchOffset / 24)), duration: 0.14 + terrain.decay * 0.12, peak: 0.07 * amount, pan, type: "triangle", startRatio: 1.18, endRatio: 0.9, filterFrequency: 1_350 });
  } else {
    scheduleNoise({ when, duration: 0.16 + terrain.decay * 0.08, peak: 0.075 * amount, pan, filterType: "highpass", filterFrequency: 1_450 + terrain.brightness * 2_200, filterQ: 0.45, offset: absoluteStep * 0.083 });
    scheduleTone({ when, frequency: 230 * (2 ** (terrain.pitchOffset / 12)), duration: 0.055, peak: 0.046 * amount, pan, type: "square", startRatio: 0.86, endRatio: 0.58, filterType: "bandpass", filterFrequency: 1_100, filterQ: 0.7 });
  }
}

function scheduleFoot(contact, terrain, when, normalization, absoluteStep) {
  if (contact.id === "tail") {
    scheduleTail(contact, terrain, when, normalization, absoluteStep);
    return;
  }
  const lane = laneById.get(contact.id);
  const laneIndex = lane?.index ?? 0;
  const pan = lanePan[contact.id] ?? 0;
  const amount = contact.intensity * normalization;
  const terrainRatio = 2 ** (terrain.pitchOffset / 12);
  const resonance = 0.45 + state.groundResonance * 0.85;
  const isFront = contact.id.startsWith("front");
  const isLeft = contact.id.endsWith("left");

  if (state.animalId === "elephant") {
    const base = (isFront ? (isLeft ? 82 : 104) : (isLeft ? 36 : 49)) * terrainRatio;
    const duration = (isFront ? 0.11 + terrain.decay * 0.2 : 0.28 + terrain.decay * 0.48) * resonance;
    scheduleTone({
      when,
      frequency: base,
      duration,
      peak: (isFront ? 0.2 : 0.28) * amount,
      pan,
      type: isFront ? (isLeft ? "triangle" : "square") : "sine",
      attack: 0.003,
      startRatio: isFront ? (isLeft ? 1.32 : 1.12) : (isLeft ? 2.05 : 1.68),
      endRatio: isFront ? 0.88 : 0.66,
      filterType: isFront ? "bandpass" : "lowpass",
      filterFrequency: isFront ? (isLeft ? 620 : 940) + terrain.brightness * 1_900 : 240 + terrain.brightness * 720,
      filterQ: isFront ? (isLeft ? 0.72 : 1.5) : 0.58,
    });
    scheduleNoise({
      when,
      duration: (isFront ? 0.055 : 0.105) + terrain.decay * (isFront ? 0.06 : 0.13),
      peak: (isFront ? (isLeft ? 0.13 : 0.085) : 0.075) * amount,
      pan,
      filterType: isFront ? "bandpass" : "lowpass",
      filterFrequency: isFront ? (isLeft ? 520 : 1_080) + terrain.brightness * 1_400 : 145 + terrain.brightness * 680,
      filterQ: isFront ? 1.1 : 0.55,
      offset: absoluteStep * 0.041 + laneIndex * 0.13,
    });
    if (terrain.id === "metal" || terrain.id === "crystal") {
      scheduleTone({ when: when + 0.006, frequency: base * (isFront ? 3.15 : 4.35), duration: duration * 0.9, peak: 0.045 * amount * state.groundResonance, pan, type: "triangle", attack: 0.002, startRatio: 1.03, endRatio: 0.98, filterType: "bandpass", filterFrequency: base * (isFront ? 3.6 : 5), filterQ: 2.2 });
    }
    return;
  }

  if (state.animalId === "unicorn") {
    const base = (isFront ? (isLeft ? 659 : 880) : (isLeft ? 196 : 247)) * terrainRatio;
    const duration = (isFront ? 0.24 + terrain.decay * 0.72 : 0.11 + terrain.decay * 0.3) * resonance;
    scheduleTone({ when, frequency: base, duration, peak: (isFront ? 0.13 : 0.18) * amount, pan, type: isFront ? "sine" : "triangle", attack: 0.002, startRatio: isFront ? 1.025 : (isLeft ? 1.28 : 1.62), endRatio: isFront ? 0.995 : 0.86, filterType: "bandpass", filterFrequency: base * (isFront ? (isLeft ? 1.7 : 2.15) : 2.7), filterQ: isFront ? (isLeft ? 1.2 : 2.1) : 0.82 });
    scheduleTone({ when: when + 0.004, frequency: base * (isFront ? (isLeft ? 2.71 : 3.04) : (isLeft ? 1.5 : 2.04)), duration: duration * (isFront ? 0.82 : 0.48), peak: (isFront ? 0.06 : 0.045) * amount, pan: -pan * 0.55, type: "sine", attack: 0.002, startRatio: 1.01, endRatio: 0.992, filterType: isFront ? "highpass" : "bandpass", filterFrequency: isFront ? 1_500 : 720, filterQ: isFront ? 0.5 : 1.4 });
    scheduleNoise({ when, duration: (isFront ? 0.035 : 0.065) + terrain.decay * 0.07, peak: (isFront ? 0.032 : 0.07) * amount, pan, filterType: isFront ? "highpass" : "bandpass", filterFrequency: isFront ? 5_200 + terrain.brightness * 3_000 : (isLeft ? 980 : 1_480) + terrain.brightness * 1_100, filterQ: isFront ? 0.4 : 1.2, offset: absoluteStep * 0.067 + laneIndex * 0.09 });
    return;
  }

  if (state.animalId === "cat") {
    const base = (isFront ? (isLeft ? 330 : 415) : (isLeft ? 118 : 146)) * terrainRatio;
    scheduleTone({ when, frequency: base, duration: (0.055 + terrain.decay * 0.12) * resonance, peak: (isFront ? 0.105 : 0.15) * amount, pan, type: "sine", attack: 0.002, startRatio: 1.16, endRatio: 0.82, filterType: "lowpass", filterFrequency: 1_150 + terrain.brightness * 1_900, filterQ: 0.72 });
    scheduleNoise({ when, duration: 0.018 + terrain.decay * 0.025, peak: 0.038 * amount, pan, filterType: "bandpass", filterFrequency: isFront ? 3_400 : 1_600, filterQ: 1.8, offset: absoluteStep * 0.091 + laneIndex * 0.07 });
    return;
  }

  if (state.animalId === "cheetah") {
    const base = (isFront ? (isLeft ? 470 : 610) : (isLeft ? 156 : 202)) * terrainRatio;
    scheduleNoise({ when, duration: 0.026 + terrain.decay * 0.035, peak: (isFront ? 0.115 : 0.14) * amount, pan, filterType: "bandpass", filterFrequency: (isFront ? 4_200 : 2_100) + terrain.brightness * 2_300, filterQ: 1.1, offset: absoluteStep * 0.113 + laneIndex * 0.12 });
    scheduleTone({ when, frequency: base, duration: 0.045 + terrain.decay * 0.08, peak: (isFront ? 0.08 : 0.13) * amount, pan, type: "triangle", attack: 0.0015, startRatio: isFront ? 1.45 : 1.82, endRatio: 0.76, filterType: "bandpass", filterFrequency: base * 3.2, filterQ: 1.2 });
    return;
  }

  if (state.animalId === "giraffe") {
    const base = (isFront ? (isLeft ? 112 : 138) : (isLeft ? 62 : 78)) * terrainRatio;
    const duration = (0.18 + terrain.decay * 0.42) * resonance;
    scheduleTone({ when, frequency: base, duration, peak: (isFront ? 0.18 : 0.2) * amount, pan, type: isFront ? "triangle" : "sine", attack: 0.004, startRatio: 1.22, endRatio: 0.72, filterType: "bandpass", filterFrequency: 420 + terrain.brightness * 1_000, filterQ: 0.8 });
    scheduleTone({ when: when + 0.006, frequency: base * (isLeft ? 2.5 : 3), duration: duration * 0.62, peak: 0.052 * amount, pan: -pan * 0.5, type: "sine", attack: 0.003, startRatio: 1.01, endRatio: 0.96, filterType: "lowpass", filterFrequency: 1_800, filterQ: 0.6 });
    return;
  }

  if (state.animalId === "lizard") {
    const base = (isFront ? (isLeft ? 780 : 1_020) : (isLeft ? 260 : 340)) * terrainRatio;
    scheduleTone({ when, frequency: base, duration: 0.025 + terrain.decay * 0.045, peak: 0.09 * amount, pan, type: isLeft ? "square" : "triangle", attack: 0.001, startRatio: 1.5, endRatio: 0.72, filterType: "highpass", filterFrequency: 950 + terrain.brightness * 2_600, filterQ: 0.7 });
    scheduleNoise({ when, duration: 0.04 + terrain.decay * 0.055, peak: 0.068 * amount, pan, filterType: "bandpass", filterFrequency: isFront ? 5_400 : 2_700, filterQ: 2.2, offset: absoluteStep * 0.137 + laneIndex * 0.08 });
    return;
  }

  const base = (isFront ? (isLeft ? 520 : 690) : (isLeft ? 174 : 220)) * terrainRatio;
  const duration = (isFront ? 0.045 + terrain.decay * 0.09 : 0.12 + terrain.decay * 0.34) * resonance;
  scheduleTone({ when, frequency: base, duration, peak: (isFront ? 0.13 : 0.18) * amount, pan, type: isFront ? (isLeft ? "square" : "triangle") : "triangle", attack: 0.0015, startRatio: isFront ? (isLeft ? 1.08 : 1.28) : (isLeft ? 1.18 : 1.34), endRatio: isFront ? 0.95 : 0.9, filterType: "bandpass", filterFrequency: base * (isFront ? (isLeft ? 1.35 : 1.8) : 2.4), filterQ: isFront ? (isLeft ? 1.8 : 0.85) : 0.9 });
  if (!isFront) scheduleTone({ when: when + 0.003, frequency: base * (isLeft ? 3.0 : 3.96), duration: duration * (isLeft ? 0.58 : 0.42), peak: 0.05 * amount, pan, type: "sine", attack: 0.0015, startRatio: 1.02, endRatio: 0.96, filterType: "highpass", filterFrequency: 900, filterQ: 0.6 });
  scheduleNoise({ when, duration: (isFront ? 0.022 : 0.038) + terrain.decay * 0.035, peak: (isFront ? (isLeft ? 0.075 : 0.052) : 0.046) * amount, pan, filterType: "bandpass", filterFrequency: (isFront ? (isLeft ? 2_900 : 4_200) : 1_650) + terrain.brightness * 2_100, filterQ: isFront ? (isLeft ? 2.4 : 1.1) : 1.3, offset: absoluteStep * 0.079 + laneIndex * 0.11 });
}

function scheduleHead(head, terrain, when, normalization = 1) {
  if (!head || !graph) return;
  const notes = (Array.isArray(head.notes) ? head.notes : []).map(Number).filter(Number.isFinite).slice(0, 6);
  if (!notes.length) return;
  const amount = clamp(head.intensity) * clamp(normalization, 0.08, 1);
  const offsets = Array.isArray(head.noteOffsetsSeconds)
    ? head.noteOffsetsSeconds.map((offset) => Math.max(0, Number(offset) || 0)).slice(0, notes.length)
    : notes.map((_, index) => index * clamp(head.phraseStepSeconds, 0.025, 0.16));
  const phraseDuration = clamp(head.phraseDurationSeconds ?? head.durationSeconds, 0.12, 1.4);
  if (head.kind === "trumpet") {
    schedulePitchContour({ when: when + 0.014, notes, offsets, duration: phraseDuration, peak: 0.22 * amount, pan: -0.08, type: "sawtooth", attack: 0.055, filterFrequency: 760 + state.mood * 720, filterQ: 0.72 });
    schedulePitchContour({ when: when + 0.018, notes, offsets, duration: phraseDuration * 0.92, peak: 0.095 * amount, pan: 0.08, type: "triangle", attack: 0.05, filterFrequency: 2_250, filterQ: 0.62, octaveOffset: 12 });
    scheduleNoise({ when: when + 0.01, duration: Math.min(0.3, phraseDuration * 0.42), peak: 0.05 * amount, pan: 0, filterType: "bandpass", filterFrequency: 940, filterQ: 0.5, offset: notes[0] * 0.013, role: "head-ornament" });
    return;
  }
  if (head.kind === "neigh-arpeggio") {
    const noteDecay = clamp(head.noteDecaySeconds, 0.1, 0.34);
    notes.forEach((note, index) => {
      const start = when + 0.012 + offsets[index];
      const frequency = midiToFrequency(note);
      scheduleTone({ when: start, frequency, duration: noteDecay, peak: 0.19 * amount, pan: (index - 2.5) * 0.13, type: index % 2 ? "sine" : "triangle", attack: 0.003, startRatio: index < 3 ? 0.965 : 1.035, endRatio: 0.994, filterType: "bandpass", filterFrequency: frequency * 1.9, filterQ: 1.15, role: "head-core" });
    });
    schedulePitchContour({ when: when + 0.012, notes, offsets, duration: phraseDuration, peak: 0.105 * amount, pan: 0, type: "sawtooth", attack: 0.025, filterFrequency: 2_200 + terrain.brightness * 1_800, filterQ: 0.5 });
    const burstIndex = Math.max(0, notes.length - 2);
    scheduleNoise({ when: when + 0.012 + offsets[burstIndex], duration: 0.065 + terrain.decay * 0.04, peak: 0.045 * amount, pan: 0.18, filterType: "highpass", filterFrequency: 4_600 + terrain.brightness * 2_800, filterQ: 0.42, offset: notes[burstIndex] * 0.021, role: "head-ornament" });
    return;
  }
  if (head.kind === "marimba-string") {
    const pluckDecay = clamp(head.pluckDecaySeconds, 0.07, 0.24);
    notes.forEach((note, index) => {
      const frequency = midiToFrequency(note);
      scheduleTone({ when: when + 0.008 + offsets[index], frequency, duration: pluckDecay, peak: 0.21 * amount, pan: (index % 2 ? 1 : -1) * (0.12 + index * 0.025), type: "triangle", attack: 0.002, startRatio: 1.16, endRatio: 0.95, filterType: "bandpass", filterFrequency: frequency * 2.25, filterQ: 0.92, role: "head-core" });
    });
    const finalIndex = notes.length - 1;
    scheduleTone({ when: when + 0.012 + offsets[finalIndex], frequency: midiToFrequency(notes[finalIndex]), duration: clamp(head.stringTailSeconds, 0.14, 0.38), peak: 0.1 * amount, pan: 0.26, type: "triangle", attack: 0.045, startRatio: 0.992, endRatio: 1.008, filterType: "lowpass", filterFrequency: 1_500 + terrain.brightness * 1_100, filterQ: 0.78, role: "head-core" });
    return;
  }
  if (head.kind === "purr-meow") {
    schedulePitchContour({ when: when + 0.01, notes, offsets, duration: phraseDuration, peak: 0.16 * amount, pan: 0.08, type: "triangle", attack: 0.025, filterFrequency: 1_250 + terrain.brightness * 900, filterQ: 1.3 });
    for (const [index, note] of notes.entries()) {
      scheduleTone({ when: when + 0.012 + offsets[index], frequency: midiToFrequency(note - 12), duration: Math.min(0.24, phraseDuration), peak: 0.07 * amount, pan: -0.16, type: "sine", attack: 0.018, startRatio: 0.97, endRatio: 1.02, filterType: "lowpass", filterFrequency: 720, filterQ: 0.8, role: "head-core" });
    }
    return;
  }
  if (head.kind === "chirp-run") {
    notes.forEach((note, index) => {
      const frequency = midiToFrequency(note);
      scheduleTone({ when: when + 0.006 + offsets[index], frequency, duration: Math.min(0.15, phraseDuration), peak: 0.14 * amount, pan: (index % 2 ? 0.24 : -0.24), type: "sine", attack: 0.002, startRatio: 0.82, endRatio: 1.16, filterType: "bandpass", filterFrequency: frequency * 2.4, filterQ: 2.1, role: "head-core" });
      scheduleTone({ when: when + 0.008 + offsets[index], frequency: frequency * 2.03, duration: 0.06, peak: 0.045 * amount, pan: 0, type: "triangle", attack: 0.0015, startRatio: 1.18, endRatio: 0.9, filterType: "highpass", filterFrequency: 2_400, filterQ: 0.5, role: "head-ornament" });
    });
    return;
  }
  if (head.kind === "neck-harp") {
    notes.forEach((note, index) => {
      const frequency = midiToFrequency(note);
      scheduleTone({ when: when + 0.01 + offsets[index], frequency, duration: Math.max(0.18, phraseDuration * 0.75), peak: 0.14 * amount, pan: (index % 2 ? 0.18 : -0.18), type: "triangle", attack: 0.035, startRatio: 0.99, endRatio: 1.01, filterType: "lowpass", filterFrequency: 1_350 + terrain.brightness * 1_200, filterQ: 0.9, role: "head-core" });
    });
    return;
  }
  if (head.kind === "hiss-click") {
    notes.forEach((note, index) => {
      scheduleTone({ when: when + 0.004 + offsets[index], frequency: midiToFrequency(note), duration: 0.055, peak: 0.1 * amount, pan: index % 2 ? 0.3 : -0.3, type: "square", attack: 0.001, startRatio: 1.24, endRatio: 0.82, filterType: "bandpass", filterFrequency: 2_900, filterQ: 1.5, role: "head-core" });
    });
    scheduleNoise({ when, duration: Math.min(0.22, phraseDuration), peak: 0.052 * amount, pan: 0, filterType: "highpass", filterFrequency: 4_200 + terrain.brightness * 2_400, filterQ: 0.6, offset: notes[0] * 0.017, role: "head-ornament" });
  }
}

function scheduleStep(absoluteStep, when, motorEvent = null) {
  const event = quadrupedSequenceEvent(state, absoluteStep);
  if (!event.contacts.length && !event.head) return;
  const motionEnergy = clamp(0.58 + (motorEvent?.velocity ?? 0) / 42, 0.48, 1);
  const normalization = motionEnergy / Math.sqrt(Math.max(1, event.contacts.length + (event.head ? 0.8 : 0)));
  for (const contact of event.contacts) {
    scheduleFoot(contact, event.terrain, when, normalization, absoluteStep);
  }
  scheduleHead(event.head, event.terrain, when, normalization);
}

function scheduleAudioWindow() {
  if (!graph || !transportPlaying || graph.context.state !== "running") return;
  const nowPerformance = performance.now();
  const snapshot = materializeMotor(nowPerformance);
  const prediction = predictQuadrupedMotor(state, motor, QUADRUPED_LIMITS.schedulerLookaheadSeconds);
  if (!Number.isFinite(nextScheduledOrdinal) || nextScheduledOrdinal < snapshot.position - 0.02) {
    nextScheduledOrdinal = Math.floor(snapshot.position + 0.0001) + 1;
  }
  let scheduled = 0;
  for (const crossing of prediction.events) {
    if (crossing.ordinal < nextScheduledOrdinal) continue;
    if (scheduled >= 8) break;
    scheduleStep(
      crossing.ordinal,
      graph.context.currentTime + Math.max(0.006, crossing.offsetSeconds),
      crossing,
    );
    nextScheduledOrdinal = crossing.ordinal + 1;
    scheduled += 1;
  }
}

function startAudioScheduler() {
  if (!graph || !transportPlaying) return;
  if (!schedulerTimer) schedulerTimer = globalThis.setInterval(scheduleAudioWindow, 20);
  scheduleAudioWindow();
}

function stopAudioScheduler() {
  if (schedulerTimer) globalThis.clearInterval(schedulerTimer);
  schedulerTimer = 0;
  nextScheduledOrdinal = null;
}

function resetAudioSchedule({ includeCurrentBoundary = false } = {}) {
  stopAudioScheduler();
  cancelFutureSources();
  if (!graph || !transportPlaying) return;
  const position = currentPosition();
  const nearestBoundary = Math.round(position);
  const startsOnBoundary = includeCurrentBoundary && Math.abs(position - nearestBoundary) < 0.05;
  nextScheduledOrdinal = startsOnBoundary ? nearestBoundary : Math.ceil(position + 0.015);
  if (startsOnBoundary) {
    const snapshot = quadrupedMotorSnapshot(state, motor);
    scheduleStep(nearestBoundary, graph.context.currentTime + 0.008, snapshot);
    nextScheduledOrdinal = nearestBoundary + 1;
  }
  startAudioScheduler();
}

function syncTransportPresentation() {
  const play = $("playButton");
  play.setAttribute("aria-pressed", String(transportPlaying));
  setOutput($("playLabel"), transportPlaying ? "Pause" : stoppedPosition > 0 ? "Resume" : "Start");
  const snapshot = quadrupedMotorSnapshot(state, motor);
  const actualCadence = Math.round(snapshot.velocity / QUADRUPED_STEP_COUNT * 60);
  setOutput($("playState"), transportPlaying
    ? snapshot.stalled
      ? "stalled · add a footfall"
      : `${actualCadence} cycles/min · ${snapshot.airborne ? "flight" : "driven"}`
    : `space · step ${mod(Math.floor(stoppedPosition), QUADRUPED_STEP_COUNT) + 1}`);
  $("stageState").dataset.state = transportPlaying ? snapshot.stalled ? "stalled" : "running" : "ready";
  syncTransportHint();
}

function startTransport() {
  if (transportPlaying) return;
  const now = performance.now();
  motorPerformance = now;
  transportPlaying = true;
  if (motor.velocity <= 0.012) wakeMotorAtFootfall(now);
  syncTransportPresentation();
  if (graph) resetAudioSchedule({ includeCurrentBoundary: true });
  if (!isAudioOn()) announce(AUDIO_OFF_MESSAGE);
  else announce(motor.velocity > 0 ? "The feet are driving the Quadruped score." : "The Quadruped is stalled. Add a footfall to create traction.");
}

function stopTransport() {
  if (!transportPlaying) return;
  materializeMotor();
  transportPlaying = false;
  stoppedPosition = motor.position;
  selectedStep = mod(Math.floor(stoppedPosition), QUADRUPED_STEP_COUNT);
  stopAudioScheduler();
  releaseAllSources();
  renderGridState();
  syncTransportPresentation();
  syncGridPlayhead(-1);
  updateStageReadouts(selectedStep, true);
  announce("Quadruped sequence paused.");
}

function toggleTransport() {
  if (transportPlaying) stopTransport();
  else startTransport();
}

function restartTransport() {
  retimeTransport(0);
  if (transportPlaying) motor = kickQuadrupedMotor(state, motor, 1);
  selectedStep = 0;
  cancelFutureSources();
  if (transportPlaying && graph) resetAudioSchedule({ includeCurrentBoundary: true });
  syncTransportPresentation();
  syncGridPlayhead(transportPlaying ? 0 : -1);
  updateStageReadouts(0, true);
  announce("Quadruped returned to step one without changing the score.");
}

function replaceState(nextState, { preservePosition = true, announceMessage = "" } = {}) {
  const now = performance.now();
  const position = preservePosition ? currentPosition(now) : 0;
  state = sanitizeQuadrupedState(nextState, state);
  retimeTransport(position, now, { preserveMotion: preservePosition });
  if (transportPlaying && motor.velocity <= 0.012) wakeMotorAtFootfall(now);
  syncAllControls();
  resetAudioSchedule();
  if (announceMessage) announce(announceMessage);
}

function switchAnimal(animalId) {
  if (animalId === state.animalId) return;
  rememberMode();
  manualImpulses.delete("head");
  headReadoutPerformanceActive = false;
  for (const record of [...activeSources]) {
    if (record.role?.startsWith("head")) cancelAudioSource(record, 0.015);
  }
  const targetAnimal = quadrupedAnimal(animalId);
  const key = `${targetAnimal.id}:${targetAnimal.defaultBehaviorId}`;
  const stored = modeMemory.get(key);
  const next = stored ?? applyQuadrupedAnimal(state, targetAnimal.id);
  replaceState({ ...next, outputLevel: state.outputLevel }, {
    announceMessage: `${targetAnimal.label} loaded. The moving playhead and output level stayed put.`,
  });
}

function switchBehavior(behaviorId) {
  if (behaviorId === state.behaviorId) return;
  rememberMode();
  const key = `${state.animalId}:${behaviorId}`;
  const stored = modeMemory.get(key);
  const next = stored ?? applyQuadrupedBehavior(state, behaviorId);
  replaceState({ ...next, outputLevel: state.outputLevel }, {
    announceMessage: `${quadrupedBehavior(behaviorId).label} pattern loaded without stopping the animal.`,
  });
}

function updateStateValue(key, value) {
  const now = performance.now();
  const position = currentPosition(now);
  state = sanitizeQuadrupedState({ ...state, [key]: value }, state);
  retimeTransport(position, now, { preserveMotion: true });
  if (key === "outputLevel" && graph) {
    graph.masterGain.gain.setTargetAtTime(state.outputLevel, graph.context.currentTime, 0.025);
  } else if (["tempoBpm", "stride", "momentum", "gravity"].includes(key)) {
    resetAudioSchedule();
  }
  syncAllControls({ grid: ["stride", "momentum", "gravity"].includes(key) });
}

function setSelectedStep(step, { announceStep = false, focus = false } = {}) {
  selectedStep = mod(Math.trunc(Number(step) || 0), QUADRUPED_STEP_COUNT);
  renderGridState();
  updateStageReadouts(selectedStep, true);
  if (focus) gridControls.find((control) => control.row === 0 && control.step === selectedStep)?.button.focus();
  if (announceStep) announce(describeQuadrupedStep(state, selectedStep));
}

function editContact(laneId, step, direction = 1) {
  const now = performance.now();
  const position = currentPosition(now);
  state = cycleQuadrupedContact(state, laneId, step, direction);
  retimeTransport(position, now, { preserveMotion: true });
  selectedStep = mod(step, QUADRUPED_STEP_COUNT);
  const amount = state.pattern[laneId][selectedStep];
  if (transportPlaying && laneId !== "tail" && amount > 0 && motor.velocity <= 0.012) {
    wakeMotorAtFootfall(now, selectedStep, amount);
  }
  rememberMode();
  renderGridState();
  syncBehaviorReadouts();
  resetAudioSchedule();
  if (isAudioOn() && amount > 0) {
    const lane = laneById.get(laneId);
    const terrain = quadrupedTerrain(state.terrain[selectedStep]);
    scheduleFoot({ ...lane, intensity: amount }, terrain, graph.context.currentTime + 0.008, 0.84, selectedStep);
  }
  announce(`${laneById.get(laneId)?.label ?? laneId}, step ${selectedStep + 1}: ${amount === 0 ? "off" : amount < 0.8 ? "soft" : "strong"}.`);
}

function editTerrain(step, direction = 1) {
  const now = performance.now();
  const position = currentPosition(now);
  state = cycleQuadrupedTerrain(state, step, direction);
  retimeTransport(position, now, { preserveMotion: true });
  selectedStep = mod(step, QUADRUPED_STEP_COUNT);
  rememberMode();
  renderGridState();
  syncBehaviorReadouts();
  resetAudioSchedule();
  updateStageReadouts(selectedStep, true);
  announce(`Step ${selectedStep + 1} ground: ${quadrupedTerrain(state.terrain[selectedStep]).label}.`);
}

function buildBehaviorButtons() {
  const fragment = document.createDocumentFragment();
  const behaviors = [...quadrupedBehaviorsForAnimal(state.animalId)].sort((left, right) => {
    const leftFit = quadrupedBehaviorFit(state.animalId, left.id) === "playful" ? 1 : 0;
    const rightFit = quadrupedBehaviorFit(state.animalId, right.id) === "playful" ? 1 : 0;
    return leftFit - rightFit;
  });
  for (const behavior of behaviors) {
    const button = document.createElement("button");
    button.type = "button";
    button.dataset.behaviorId = behavior.id;
    button.dataset.fit = quadrupedBehaviorFit(state.animalId, behavior.id);
    button.textContent = behavior.label;
    button.title = `${behavior.description}${button.dataset.fit === "playful" ? " · playful transfer" : ""}`;
    button.setAttribute("aria-pressed", String(behavior.id === state.behaviorId));
    button.addEventListener("click", () => switchBehavior(behavior.id));
    fragment.append(button);
  }
  $("behaviorButtons").replaceChildren(fragment);
  behaviorButtonAnimalId = state.animalId;
}

function createGridButton(row, step, label) {
  const button = document.createElement("button");
  button.type = "button";
  button.dataset.row = String(row);
  button.dataset.step = String(step);
  button.tabIndex = row === 0 && step === 0 ? 0 : -1;
  button.setAttribute("aria-describedby", "sequenceHelp");
  button.setAttribute("aria-label", label);
  button.addEventListener("focus", () => {
    for (const control of gridControls) control.button.tabIndex = control.button === button ? 0 : -1;
    selectedStep = step;
    renderGridState();
    updateStageReadouts(step, true);
  });
  button.addEventListener("keydown", handleGridKeydown);
  return button;
}

function drawCabinetPose(canvasElement, step) {
  const context = canvasElement.getContext("2d");
  const width = canvasElement.width;
  const height = canvasElement.height;
  const pose = deriveQuadrupedPose(state, step + 0.42);
  const ink = "#402f22";
  const fadedInk = "rgba(64, 47, 34, 0.48)";
  const groundY = height - 17;
  const bodyY = (state.animalId === "lizard" ? 46 : state.animalId === "giraffe" ? 41 : 36) - pose.bodyLift * 7;
  const bodyWidth = state.animalId === "elephant" ? 32 : state.animalId === "lizard" ? 35 : ["cat", "cheetah"].includes(state.animalId) ? 32 : state.animalId === "gazelle" ? 29 : 31;
  const bodyHeight = state.animalId === "elephant" ? 14 : state.animalId === "lizard" ? 5 : ["cat", "cheetah"].includes(state.animalId) ? 8 : state.animalId === "gazelle" ? 9 : 11;

  context.clearRect(0, 0, width, height);
  context.fillStyle = "#e6d4ad";
  context.fillRect(0, 0, width, height);
  context.fillStyle = "rgba(85, 56, 32, 0.07)";
  for (let mark = 0; mark < 12; mark += 1) {
    const x = mod(step * 19 + mark * 37, width);
    const y = mod(step * 11 + mark * 23, height);
    context.fillRect(x, y, mark % 3 === 0 ? 2 : 1, 1);
  }
  context.strokeStyle = "rgba(64, 47, 34, 0.52)";
  context.lineWidth = 1;
  context.beginPath();
  context.moveTo(6, groundY);
  context.lineTo(width - 6, groundY);
  context.stroke();

  const hips = Object.freeze({
    "rear-left": 32,
    "rear-right": 42,
    "front-left": 64,
    "front-right": 73,
  });
  const drawMiniLeg = (laneId, far) => {
    const leg = pose.legs[laneId];
    const hipX = hips[laneId];
    const hipY = bodyY + bodyHeight * 0.25;
    const hoofX = hipX + leg.swing * 4.4;
    const hoofY = groundY - leg.lift * 17;
    const kneeX = (hipX + hoofX) * 0.5 + (laneId.startsWith("front") ? 1.7 : -1.7);
    const kneeY = (hipY + hoofY) * 0.5 + 3;
    context.save();
    context.globalAlpha = far ? 0.48 : 1;
    context.strokeStyle = ink;
    context.lineWidth = state.animalId === "elephant" ? 4 : 2.5;
    context.lineCap = "round";
    context.lineJoin = "round";
    context.beginPath();
    context.moveTo(hipX, hipY);
    context.lineTo(kneeX, kneeY);
    context.lineTo(hoofX, hoofY);
    context.stroke();
    context.lineWidth = state.animalId === "elephant" ? 4.5 : 3.2;
    context.beginPath();
    context.moveTo(hoofX - 2, hoofY);
    context.lineTo(hoofX + 2.5, hoofY);
    context.stroke();
    context.restore();
  };
  drawMiniLeg("rear-left", true);
  drawMiniLeg("front-left", true);

  context.fillStyle = "rgba(64, 47, 34, 0.13)";
  context.strokeStyle = ink;
  context.lineWidth = 2;
  context.beginPath();
  context.ellipse(52, bodyY, bodyWidth, bodyHeight, pose.bodyPitch, 0, Math.PI * 2);
  context.fill();
  context.stroke();
  if (state.animalId === "cheetah") {
    context.fillStyle = ink;
    for (let spot = 0; spot < 5; spot += 1) {
      context.beginPath();
      context.arc(39 + spot * 7, bodyY + (spot % 2 ? 2 : -2), 1, 0, Math.PI * 2);
      context.fill();
    }
  }
  context.strokeStyle = ink;
  context.lineWidth = state.animalId === "elephant" ? 3.5 : 2;
  context.beginPath();
  context.moveTo(22, bodyY - 2);
  context.quadraticCurveTo(12, bodyY + pose.tailAngle * 5, 8, bodyY + 8 + pose.tailAngle * 7);
  context.stroke();

  drawMiniLeg("rear-right", false);
  drawMiniLeg("front-right", false);
  const headX = 84;
  const headY = state.animalId === "giraffe" ? bodyY - 19 - pose.headLift * 1.5 : bodyY - 5 - pose.headLift * 3;
  if (state.animalId === "giraffe") {
    context.strokeStyle = ink;
    context.lineWidth = 5;
    context.beginPath();
    context.moveTo(73, bodyY - 2);
    context.lineTo(82, headY + 5);
    context.stroke();
  }
  context.fillStyle = "rgba(64, 47, 34, 0.1)";
  context.strokeStyle = ink;
  context.lineWidth = 2;
  context.beginPath();
  context.ellipse(headX, headY, state.animalId === "elephant" ? 9 : 7, state.animalId === "elephant" ? 10 : 9, -0.28, 0, Math.PI * 2);
  context.fill();
  context.stroke();
  if (state.animalId === "elephant") {
    context.lineWidth = 4;
    context.lineCap = "round";
    context.beginPath();
    context.moveTo(89, headY + 4);
    context.quadraticCurveTo(97, headY + 11 - pose.headPerformance.trunkRaise * 20, 94, headY + 17 - pose.headPerformance.trunkRaise * 28);
    context.stroke();
  } else if (state.animalId === "unicorn") {
    context.beginPath();
    context.ellipse(90, headY + 3, 6, 3.6, -0.15, 0, Math.PI * 2);
    context.stroke();
    context.beginPath();
    context.moveTo(83, headY - 8);
    context.lineTo(88, headY - 20);
    context.stroke();
    context.fillStyle = ink;
    context.beginPath();
    context.arc(93, headY + 2, 1.2, 0, Math.PI * 2);
    context.fill();
  } else if (state.animalId === "gazelle") {
    context.beginPath();
    context.moveTo(81, headY - 8);
    context.quadraticCurveTo(76, headY - 18, 79, headY - 23);
    context.moveTo(85, headY - 8);
    context.quadraticCurveTo(91, headY - 18, 88, headY - 23);
    context.stroke();
  } else if (["cat", "cheetah"].includes(state.animalId)) {
    context.fillStyle = ink;
    context.beginPath();
    context.moveTo(80, headY - 6);
    context.lineTo(80, headY - 14);
    context.lineTo(84, headY - 8);
    context.moveTo(86, headY - 7);
    context.lineTo(89, headY - 14);
    context.lineTo(91, headY - 5);
    context.fill();
  } else if (state.animalId === "giraffe") {
    context.beginPath();
    context.moveTo(82, headY - 8);
    context.lineTo(81, headY - 11);
    context.moveTo(87, headY - 8);
    context.lineTo(89, headY - 11);
    context.stroke();
  } else if (state.animalId === "lizard") {
    context.beginPath();
    context.moveTo(87, headY + 1);
    context.lineTo(99, headY + 2);
    context.stroke();
  }
  context.fillStyle = ink;
  context.beginPath();
  context.arc(86, headY - 2, 1.2, 0, Math.PI * 2);
  context.fill();

  ["front-left", "front-right", "rear-left", "rear-right"].forEach((laneId, index) => {
    const value = state.pattern[laneId][step];
    const lane = laneById.get(laneId);
    const x = 23 + index * 20;
    context.beginPath();
    context.arc(x, height - 8, value > 0.8 ? 4 : value > 0 ? 3 : 1.7, 0, Math.PI * 2);
    context.fillStyle = value > 0 ? lane.color : fadedInk;
    context.fill();
    if (value > 0) {
      context.strokeStyle = ink;
      context.lineWidth = 0.8;
      context.stroke();
    }
  });
  if (state.pattern.tail[step] > 0) {
    context.fillStyle = laneById.get("tail").color;
    context.font = "bold 11px ui-monospace, monospace";
    context.fillText("✦", width - 14, 13);
  }
  canvasElement.parentElement.dataset.air = String(pose.airborne);
}

function buildSequenceGrid() {
  gridControls.length = 0;
  cabinetFrames.length = 0;
  laneLabelElements.clear();
  const fragment = document.createDocumentFragment();
  const motionRow = document.createElement("div");
  motionRow.className = "quadruped-grid-row quadruped-cabinet-row";
  motionRow.setAttribute("role", "row");
  const motionLabel = document.createElement("span");
  motionLabel.className = "quadruped-grid-row-label";
  motionLabel.setAttribute("role", "rowheader");
  motionLabel.style.setProperty("--lane-color", "#d7b36a");
  const motionMarker = document.createElement("i");
  motionMarker.setAttribute("aria-hidden", "true");
  motionLabel.append(motionMarker, document.createTextNode("MOTION · cards"));
  motionRow.append(motionLabel);
  for (let step = 0; step < QUADRUPED_STEP_COUNT; step += 1) {
    const cell = document.createElement("span");
    cell.setAttribute("role", "gridcell");
    const button = createGridButton(-1, step, `Motion-study frame ${step + 1}`);
    button.className = "quadruped-cabinet-frame";
    const preview = document.createElement("canvas");
    preview.width = 112;
    preview.height = 82;
    preview.setAttribute("aria-hidden", "true");
    const number = document.createElement("small");
    number.textContent = String(step + 1).padStart(2, "0");
    button.append(preview, number);
    button.addEventListener("click", () => setSelectedStep(step, { announceStep: true }));
    cell.append(button);
    motionRow.append(cell);
    const control = { button, row: -1, step, frame: true, canvas: preview };
    gridControls.push(control);
    cabinetFrames.push(control);
  }
  fragment.append(motionRow);
  QUADRUPED_LANES.forEach((lane, row) => {
    const rowElement = document.createElement("div");
    rowElement.className = "quadruped-grid-row";
    rowElement.setAttribute("role", "row");
    const rowLabel = document.createElement("span");
    rowLabel.className = "quadruped-grid-row-label";
    rowLabel.setAttribute("role", "rowheader");
    rowLabel.style.setProperty("--lane-color", lane.color);
    const marker = document.createElement("i");
    marker.setAttribute("aria-hidden", "true");
    const copy = document.createElement("span");
    copy.textContent = `${lane.shortLabel} · ${quadrupedFootVoice(state.animalId, lane.id).label}`;
    rowLabel.append(marker, copy);
    laneLabelElements.set(lane.id, copy);
    rowElement.append(rowLabel);
    for (let step = 0; step < QUADRUPED_STEP_COUNT; step += 1) {
      const cell = document.createElement("span");
      cell.setAttribute("role", "gridcell");
      const button = createGridButton(row, step, `${lane.label}, step ${step + 1}`);
      button.className = "quadruped-grid-cell";
      button.style.setProperty("--lane-color", lane.color);
      button.dataset.laneId = lane.id;
      button.dataset.stepLabel = String(step + 1).padStart(2, "0");
      button.addEventListener("click", (event) => editContact(lane.id, step, event.shiftKey ? -1 : 1));
      cell.append(button);
      rowElement.append(cell);
      gridControls.push({ button, row, step, laneId: lane.id });
    }
    fragment.append(rowElement);
  });

  const terrainRow = document.createElement("div");
  terrainRow.className = "quadruped-grid-row quadruped-ground-row";
  terrainRow.setAttribute("role", "row");
  const terrainLabel = document.createElement("span");
  terrainLabel.className = "quadruped-grid-row-label";
  terrainLabel.setAttribute("role", "rowheader");
  terrainLabel.style.setProperty("--lane-color", "#f4fff9");
  const marker = document.createElement("i");
  marker.setAttribute("aria-hidden", "true");
  terrainLabel.append(marker, document.createTextNode("GROUND · resonator"));
  terrainRow.append(terrainLabel);
  for (let step = 0; step < QUADRUPED_STEP_COUNT; step += 1) {
    const cell = document.createElement("span");
    cell.setAttribute("role", "gridcell");
    const button = createGridButton(QUADRUPED_LANES.length, step, `Ground material, step ${step + 1}`);
    button.className = "quadruped-terrain-cell";
    button.addEventListener("click", (event) => editTerrain(step, event.shiftKey ? -1 : 1));
    cell.append(button);
    terrainRow.append(cell);
    gridControls.push({ button, row: QUADRUPED_LANES.length, step, terrain: true });
  }
  fragment.append(terrainRow);
  $("sequenceGrid").replaceChildren(fragment);
  $("sequenceGrid").setAttribute("aria-rowcount", String(QUADRUPED_LANES.length + 2));
  $("sequenceGrid").setAttribute("aria-colcount", String(QUADRUPED_STEP_COUNT));
  renderGridState();
}

function handleGridKeydown(event) {
  const button = event.currentTarget;
  const row = Number(button.dataset.row);
  const step = Number(button.dataset.step);
  let nextRow = row;
  let nextStep = step;
  if (event.key === "ArrowLeft") nextStep -= 1;
  else if (event.key === "ArrowRight") nextStep += 1;
  else if (event.key === "ArrowUp") nextRow -= 1;
  else if (event.key === "ArrowDown") nextRow += 1;
  else if (event.key === "Home") nextStep = 0;
  else if (event.key === "End") nextStep = QUADRUPED_STEP_COUNT - 1;
  else if ((event.key === "Delete" || event.key === "Backspace") && row >= 0 && row < QUADRUPED_LANES.length) {
    event.preventDefault();
    const laneId = QUADRUPED_LANES[row].id;
    const now = performance.now();
    const position = currentPosition(now);
    state = setQuadrupedContact(state, laneId, step, 0);
    retimeTransport(position, now, { preserveMotion: true });
    rememberMode();
    renderGridState();
    syncBehaviorReadouts();
    resetAudioSchedule();
    announce(`${QUADRUPED_LANES[row].label}, step ${step + 1}: off.`);
    return;
  } else {
    return;
  }
  event.preventDefault();
  nextRow = clamp(nextRow, -1, QUADRUPED_LANES.length);
  nextStep = mod(nextStep, QUADRUPED_STEP_COUNT);
  for (const control of gridControls) control.button.tabIndex = -1;
  const target = gridControls.find((control) => control.row === nextRow && control.step === nextStep);
  target?.button.focus();
  if (target) target.button.tabIndex = 0;
}

function contactLevelName(value) {
  if (value <= 0) return "off";
  return value < 0.8 ? "soft" : "strong";
}

function renderGridState() {
  for (const lane of QUADRUPED_LANES) {
    const label = laneLabelElements.get(lane.id);
    if (label) label.textContent = `${lane.shortLabel} · ${quadrupedFootVoice(state.animalId, lane.id).label}`;
  }
  for (const control of gridControls) {
    const selected = control.step === selectedStep;
    control.button.dataset.selected = String(selected);
    if (control.frame) {
      drawCabinetPose(control.canvas, control.step);
      const pose = deriveQuadrupedPose(state, control.step + 0.42);
      control.button.setAttribute("aria-label", `Motion-study frame ${control.step + 1}, ${pose.airborne ? "airborne" : `${pose.groundSupportCount} feet supporting`}.`);
      continue;
    }
    if (control.terrain) {
      const terrain = terrainById.get(state.terrain[control.step]) ?? QUADRUPED_TERRAINS[0];
      control.button.style.setProperty("--terrain-color", terrain.color);
      control.button.textContent = terrain.shortLabel;
      control.button.setAttribute("aria-label", `Ground material, step ${control.step + 1}: ${terrain.label}. Activate to cycle; Shift activate for previous.`);
      continue;
    }
    const value = state.pattern[control.laneId][control.step];
    const level = contactLevelName(value);
    const lane = laneById.get(control.laneId);
    control.button.style.setProperty("--level", String(value));
    control.button.dataset.level = level;
    control.button.textContent = value <= 0 ? "·" : value < 0.8 ? "○" : "●";
    control.button.setAttribute("aria-pressed", String(value > 0));
    control.button.setAttribute("aria-label", `${lane.label}, step ${control.step + 1}: ${level}. Activate to cycle; Shift activate for previous.`);
  }
}

function syncGridPlayhead(step) {
  if (lastPlayingStep === step) return;
  lastPlayingStep = step;
  for (const control of gridControls) control.button.dataset.playing = String(step >= 0 && control.step === step);
}

function behaviorDescription() {
  const behavior = quadrupedBehavior(state.behaviorId);
  const caveat = quadrupedBehaviorFit(state.animalId, state.behaviorId) === "playful" ? " · playful transfer" : "";
  return `${state.customized ? "Custom · " : ""}${behavior.description}${caveat}`;
}

function syncBehaviorReadouts() {
  const behavior = quadrupedBehavior(state.behaviorId);
  setOutput($("behaviorDescription"), behaviorDescription());
  setOutput($("behaviorReadout"), state.customized ? `${behavior.label} · custom` : behavior.label);
}

function syncTheme() {
  const animal = quadrupedAnimal(state.animalId);
  const root = document.documentElement;
  root.style.setProperty("--quad-animal", animal.palette[0]);
  root.style.setProperty("--quad-animal-dark", animal.palette[1]);
  root.style.setProperty("--quad-live", animal.palette[2]);
  root.style.setProperty("--quad-accent", animal.palette[4]);
  document.body.dataset.animal = animal.id;
}

function syncAllControls({ grid = true } = {}) {
  const animal = quadrupedAnimal(state.animalId);
  const behavior = quadrupedBehavior(state.behaviorId);
  syncTheme();
  if (behaviorButtonAnimalId !== state.animalId) buildBehaviorButtons();
  document.querySelectorAll("[data-animal-id]").forEach((button) => {
    button.setAttribute("aria-pressed", String(button.dataset.animalId === state.animalId));
  });
  document.querySelectorAll("[data-behavior-id]").forEach((button) => {
    button.setAttribute("aria-pressed", String(button.dataset.behaviorId === state.behaviorId));
  });
  document.querySelectorAll("#padGrid [data-lane-id]").forEach((button) => {
    const lane = laneById.get(button.dataset.laneId);
    if (!lane) return;
    const voice = quadrupedFootVoice(state.animalId, lane.id);
    const copy = button.querySelector("span");
    if (copy) copy.textContent = `${lane.shortLabel} ${voice.label}`;
    button.setAttribute("aria-label", `${lane.label}: ${voice.label}`);
  });
  $("tempo").value = String(state.tempoBpm);
  $("stride").value = String(state.stride);
  $("momentum").value = String(state.momentum);
  $("gravity").value = String(state.gravity);
  $("mood").value = String(state.mood);
  $("groundResonance").value = String(state.groundResonance);
  $("level").value = String(state.outputLevel);
  setOutput($("tempoOut"), `${Math.round(state.tempoBpm)} cycles/min`);
  setOutput($("strideOut"), `${Math.round((state.stride - QUADRUPED_LIMITS.stride[0]) / (QUADRUPED_LIMITS.stride[1] - QUADRUPED_LIMITS.stride[0]) * 100)}%`);
  setOutput($("momentumOut"), `${Math.round(state.momentum * 100)}%`);
  setOutput($("gravityOut"), `${Math.round(state.gravity * 100)}%`);
  setOutput($("moodOut"), `${Math.round(state.mood * 100)}%`);
  setOutput($("groundResonanceOut"), `${Math.round(state.groundResonance * 100)}%`);
  setOutput($("levelOut"), `${Math.round(state.outputLevel * 100)}%`);
  setOutput($("animalDescription"), animal.description);
  syncBehaviorReadouts();
  const moodLabel = state.mood < 0.34 ? "watchful" : state.mood < 0.7 ? "grounded" : "ecstatic";
  setOutput($("motionSummary"), `${Math.round(state.tempoBpm)} cycles/min · ${moodLabel}`);
  setOutput($("animalReadout"), animal.label);
  if (graph) graph.masterGain.gain.setTargetAtTime(state.outputLevel, graph.context.currentTime, 0.025);
  if (grid) renderGridState();
  syncTransportPresentation();
  updateStageReadouts(transportPlaying ? mod(Math.floor(currentPosition()), QUADRUPED_STEP_COUNT) : selectedStep, true);
}

function updateStageReadouts(step, force = false) {
  const safeStep = mod(step, QUADRUPED_STEP_COUNT);
  if (!force && safeStep === lastReadoutStep) return;
  lastReadoutStep = safeStep;
  const event = quadrupedSequenceEvent(state, safeStep);
  const animal = quadrupedAnimal(state.animalId);
  const behavior = quadrupedBehavior(state.behaviorId);
  setOutput($("stageStep"), `${String(safeStep + 1).padStart(2, "0")} / ${QUADRUPED_STEP_COUNT}`);
  setOutput($("terrainReadout"), event.terrain.label);
  setOutput($("headReadout"), event.head ? headLabel(event.head) : "waiting");
  setOutput($("stageCode"), `${animal.label.toUpperCase()} / ${behavior.label.toUpperCase()} / ${event.terrain.shortLabel}`);
}

function headLabel(head) {
  if (head?.kind === "trumpet") return "trumpet call";
  if (head?.kind === "neigh-arpeggio") return "sparkle neigh";
  if (head?.kind === "marimba-string") return "marimba + strings";
  if (head?.kind === "purr-meow") return "purr glissando";
  if (head?.kind === "chirp-run") return "sprint chirps";
  if (head?.kind === "neck-harp") return "neck harp";
  if (head?.kind === "hiss-click") return "hiss clicks";
  return "head voice";
}

function manualHeadEvent() {
  return quadrupedHeadPhrase(state, selectedStep);
}

function flashPad(button) {
  button.dataset.flash = "true";
  const timer = globalThis.setTimeout(() => {
    uiTimers.delete(timer);
    button.dataset.flash = "false";
  }, 130);
  uiTimers.add(timer);
}

function triggerManualLane(laneId, button = null) {
  const lane = laneById.get(laneId);
  if (!lane) return;
  manualImpulses.set(laneId, performance.now());
  if (button) flashPad(button);
  if (graph && isAudioOn()) {
    const terrain = quadrupedTerrain(state.terrain[selectedStep]);
    scheduleFoot({ ...lane, intensity: 1 }, terrain, graph.context.currentTime + 0.008, 0.82, selectedStep);
    announce(`${lane.label} struck ${terrain.label}.`);
  } else {
    announce("Audio is off — turn it on to hear this body hit.");
  }
}

function triggerManualHead(button = null) {
  const triggerTime = performance.now();
  const head = manualHeadEvent();
  manualImpulses.set("head", {
    started: triggerTime,
    phrase: head,
  });
  if (button) flashPad(button);
  setOutput($("headReadout"), headLabel(head));
  if (graph && isAudioOn()) {
    if (triggerTime - lastManualHeadAudioTime >= 48) {
      lastManualHeadAudioTime = triggerTime;
      scheduleHead(head, quadrupedTerrain(state.terrain[selectedStep]), graph.context.currentTime + 0.008, 0.82);
    }
    announce(`${quadrupedAnimal(state.animalId).label}: ${headLabel(head)}.`);
  } else {
    announce("Audio is off — turn it on to hear the head.");
  }
}

function roundedRect(context, x, y, width, height, radius) {
  const safeRadius = Math.min(radius, Math.abs(width) / 2, Math.abs(height) / 2);
  context.beginPath();
  context.roundRect(x, y, width, height, safeRadius);
}

function drawTerrainTile(context, terrain, x, y, width, height, active, step) {
  context.save();
  roundedRect(context, x + 1, y, width - 2, height, Math.max(3, width * 0.08));
  context.fillStyle = terrain.color;
  context.globalAlpha = active ? 0.94 : 0.58;
  context.fill();
  context.clip();
  context.globalAlpha = active ? 0.8 : 0.35;
  context.strokeStyle = "rgba(4, 13, 11, 0.64)";
  context.fillStyle = "rgba(255, 255, 255, 0.35)";
  context.lineWidth = 1;
  if (terrain.id === "earth") {
    for (let index = 0; index < 5; index += 1) {
      const px = x + width * ((index * 0.29 + step * 0.17) % 0.9 + 0.05);
      const py = y + height * (0.24 + ((index * 0.37 + step * 0.11) % 0.58));
      context.beginPath();
      context.arc(px, py, Math.max(1, width * 0.025), 0, Math.PI * 2);
      context.fill();
    }
  } else if (terrain.id === "wood") {
    for (let offset = 0.25; offset < 1; offset += 0.28) {
      context.beginPath();
      context.moveTo(x, y + height * offset);
      context.bezierCurveTo(x + width * 0.3, y + height * (offset - 0.08), x + width * 0.7, y + height * (offset + 0.08), x + width, y + height * offset);
      context.stroke();
    }
  } else if (terrain.id === "metal") {
    context.setLineDash([Math.max(2, width * 0.1), Math.max(2, width * 0.08)]);
    context.beginPath();
    context.moveTo(x, y + height * 0.32);
    context.lineTo(x + width, y + height * 0.32);
    context.moveTo(x, y + height * 0.7);
    context.lineTo(x + width, y + height * 0.7);
    context.stroke();
  } else {
    context.beginPath();
    context.moveTo(x + width * 0.12, y + height);
    context.lineTo(x + width * 0.46, y + height * 0.14);
    context.lineTo(x + width * 0.7, y + height);
    context.moveTo(x + width * 0.43, y + height);
    context.lineTo(x + width * 0.78, y + height * 0.28);
    context.stroke();
  }
  context.restore();
  if (active) {
    context.save();
    roundedRect(context, x + 1, y, width - 2, height, Math.max(3, width * 0.08));
    context.strokeStyle = "#ffffff";
    context.lineWidth = 2;
    context.shadowColor = terrain.color;
    context.shadowBlur = 15;
    context.stroke();
    context.restore();
  }
}

function drawStepContactNotes(context, step, x, y, width, height, active) {
  context.save();
  if (width < 22) {
    const laneHeight = Math.max(2, Math.min(4, height * 0.025));
    for (let index = 0; index < QUADRUPED_LANES.length; index += 1) {
      const lane = QUADRUPED_LANES[index];
      const value = clamp(state.pattern[lane.id][step]);
      if (value <= 0) continue;
      context.globalAlpha = 0.48 + value * 0.5;
      context.fillStyle = lane.color;
      context.fillRect(x + width * 0.18, y + height * 0.1 + index * laneHeight * 1.45, width * 0.64, laneHeight);
    }
    context.restore();
    return;
  }
  const radius = Math.max(2, Math.min(5, width * 0.052));
  const gap = width / (QUADRUPED_LANES.length + 1);
  for (let index = 0; index < QUADRUPED_LANES.length; index += 1) {
    const lane = QUADRUPED_LANES[index];
    const value = clamp(state.pattern[lane.id][step]);
    const noteX = x + gap * (index + 1);
    const noteY = y + height * (0.16 + (index % 2) * 0.085);
    context.globalAlpha = value > 0 ? 0.46 + value * 0.5 : 0.2;
    context.fillStyle = lane.color;
    context.strokeStyle = active ? "#ffffff" : "rgba(4, 13, 11, 0.8)";
    context.lineWidth = active ? 1.5 : 1;
    context.beginPath();
    context.arc(noteX, noteY, radius * (0.78 + value * 0.52), 0, Math.PI * 2);
    if (value > 0) context.fill();
    context.stroke();
  }
  context.restore();
}

function impulseStrength(id, now) {
  const record = manualImpulses.get(id);
  const started = typeof record === "number" ? record : record?.started;
  if (!Number.isFinite(started)) return 0;
  const elapsed = (now - started) / 1_000;
  const duration = id === "head"
    ? clamp(record?.phrase?.phraseDurationSeconds ?? record?.phrase?.durationSeconds, 0.12, 1.4)
    : 0.7;
  if (elapsed > duration) {
    manualImpulses.delete(id);
    return 0;
  }
  if (id === "head") {
    const progress = clamp(elapsed / duration);
    const attack = clamp(elapsed / Math.min(0.08, duration * 0.22));
    return clamp(Math.sin(attack * Math.PI * 0.5) * (1 - progress * 0.72));
  }
  return Math.exp(-elapsed * 7);
}

function manualHeadSignals(now) {
  const record = manualImpulses.get("head");
  const phrase = record?.phrase;
  const started = record?.started;
  if (!phrase || !Number.isFinite(started)) return null;
  const strength = impulseStrength("head", now);
  if (strength <= 0) return null;
  const elapsed = Math.max(0, (now - started) / 1_000);
  const offsets = phrase.noteOffsetsSeconds ?? [0];
  let noteIndex = 0;
  for (let index = 0; index < offsets.length; index += 1) {
    if (offsets[index] <= elapsed + 0.0001) noteIndex = index;
  }
  const notePulse = clamp(Math.exp(-Math.max(0, elapsed - (offsets[noteIndex] ?? 0)) * 30));
  return {
    kind: phrase.kind,
    gesture: phrase.gesture,
    strength,
    noteIndex,
    notePulse,
    trunkRaise: phrase.gesture === "trunk-lift" ? strength : 0,
    hornPulse: phrase.gesture === "horn-neigh" ? Math.max(strength * 0.42, notePulse) : 0,
    headToss: phrase.gesture === "head-toss" ? strength * (0.52 + notePulse * 0.48) : 0,
    earFlick: phrase.gesture === "head-toss" ? notePulse * (noteIndex % 2 === 0 ? 1 : 0.62) : 0,
    whiskerPulse: phrase.gesture === "whisker-meow" ? Math.max(strength * 0.5, notePulse) : 0,
    spineFlex: phrase.gesture === "spine-chirp" ? strength * (noteIndex % 2 ? -1 : 1) : 0,
    neckSway: phrase.gesture === "neck-sway" ? strength * Math.sin((noteIndex + elapsed * 3) * Math.PI * 0.7) : 0,
    tongueFlick: phrase.gesture === "tongue-flick" ? notePulse : 0,
  };
}

function headPerformanceStrength(pose, now) {
  const automaticStrength = transportPlaying
    ? pose.headPerformance?.strength ?? pose.headExpression ?? 0
    : 0;
  return clamp(Math.max(automaticStrength, impulseStrength("head", now)));
}

function headPerformanceSignals(pose, now) {
  const automatic = transportPlaying ? pose.headPerformance ?? {} : {};
  const manual = manualHeadSignals(now);
  const strength = headPerformanceStrength(pose, now);
  const primary = manual && manual.strength >= (automatic.strength ?? 0) ? manual : automatic;
  return {
    ...primary,
    strength,
    trunkRaise: Math.max(automatic.trunkRaise ?? 0, manual?.trunkRaise ?? 0),
    hornPulse: Math.max(automatic.hornPulse ?? 0, manual?.hornPulse ?? 0),
    headToss: Math.max(automatic.headToss ?? 0, manual?.headToss ?? 0),
    earFlick: Math.max(automatic.earFlick ?? 0, manual?.earFlick ?? 0),
    whiskerPulse: Math.max(automatic.whiskerPulse ?? 0, manual?.whiskerPulse ?? 0),
    spineFlex: Math.abs(manual?.spineFlex ?? 0) > Math.abs(automatic.spineFlex ?? 0) ? manual.spineFlex : automatic.spineFlex ?? 0,
    neckSway: Math.abs(manual?.neckSway ?? 0) > Math.abs(automatic.neckSway ?? 0) ? manual.neckSway : automatic.neckSway ?? 0,
    tongueFlick: Math.max(automatic.tongueFlick ?? 0, manual?.tongueFlick ?? 0),
  };
}

function drawContactRipple(context, x, groundY, color, strength, scale) {
  if (strength < 0.02) return;
  context.save();
  context.globalAlpha = clamp(strength);
  context.strokeStyle = color;
  context.lineWidth = Math.max(1, scale * 0.045);
  context.beginPath();
  context.ellipse(x, groundY + scale * 0.02, scale * (0.12 + (1 - strength) * 0.32), scale * 0.045, 0, 0, Math.PI * 2);
  context.stroke();
  context.restore();
}

function drawLeg(context, id, hipX, hipY, groundY, bodyScale, pose, color, far, now) {
  const leg = pose.legs[id];
  const manual = impulseStrength(id, now);
  const lift = Math.max(leg.lift, manual * 0.24);
  const impact = Math.max(leg.impact, manual);
  const hoofX = hipX + leg.swing * bodyScale * 0.31;
  const hoofY = groundY - lift * bodyScale * 0.46;
  const kneeX = (hipX + hoofX) / 2 + (id.startsWith("front") ? 1 : -1) * bodyScale * (0.04 + leg.swing * 0.025);
  const kneeY = (hipY + hoofY) / 2 + bodyScale * 0.06;
  context.save();
  context.globalAlpha = far ? 0.56 : 1;
  context.strokeStyle = color;
  context.lineWidth = Math.max(3, bodyScale * (state.animalId === "elephant" ? 0.11 : 0.062));
  context.lineCap = "round";
  context.lineJoin = "round";
  context.beginPath();
  context.moveTo(hipX, hipY);
  context.lineTo(kneeX, kneeY);
  context.lineTo(hoofX, hoofY);
  context.stroke();
  context.strokeStyle = quadrupedAnimal(state.animalId).palette[3];
  context.lineWidth = Math.max(3, bodyScale * (state.animalId === "elephant" ? 0.13 : 0.085));
  context.beginPath();
  context.moveTo(hoofX - bodyScale * 0.055, hoofY);
  context.lineTo(hoofX + bodyScale * 0.065, hoofY);
  context.stroke();
  context.restore();
  drawContactRipple(context, hoofX, groundY, laneById.get(id).color, impact, bodyScale);
}

function drawEyeAndMouth(context, headX, headY, size, pose, facing = 1) {
  context.save();
  context.fillStyle = "#07100f";
  context.beginPath();
  context.ellipse(headX + facing * size * 0.16, headY - size * 0.12, size * 0.055, size * 0.055 * pose.eyeOpen, 0, 0, Math.PI * 2);
  context.fill();
  context.strokeStyle = "#07100f";
  context.lineWidth = Math.max(1.5, size * 0.025);
  context.lineCap = "round";
  context.beginPath();
  context.moveTo(headX + facing * size * 0.12, headY + size * 0.17);
  context.quadraticCurveTo(headX + facing * size * 0.24, headY + size * (0.2 + pose.smile * 0.08), headX + facing * size * 0.34, headY + size * 0.15);
  context.stroke();
  context.restore();
}

function drawHeadAura(context, headX, headY, size, pose, performanceState) {
  const strength = clamp(performanceState.strength);
  if (strength < 0.02) return;
  const animal = quadrupedAnimal(state.animalId);
  context.save();
  context.globalAlpha = 0.2 + strength * 0.55;
  context.strokeStyle = animal.palette[2];
  context.lineWidth = Math.max(1, size * 0.025);
  context.shadowColor = animal.palette[2];
  context.shadowBlur = size * 0.3;
  const rays = state.animalId === "unicorn" ? 9 : state.animalId === "elephant" ? 5 : 7;
  for (let index = 0; index < rays; index += 1) {
    const angle = index / rays * Math.PI * 2 + pose.phase * 0.35;
    const inner = size * (0.62 + strength * 0.12);
    const outer = size * (0.8 + strength * 0.32);
    context.beginPath();
    context.moveTo(headX + Math.cos(angle) * inner, headY + Math.sin(angle) * inner);
    context.lineTo(headX + Math.cos(angle) * outer, headY + Math.sin(angle) * outer);
    context.stroke();
  }
  context.restore();
}

function drawAnimal(context, pose, width, height, groundY, now) {
  const animal = quadrupedAnimal(state.animalId);
  const performanceState = headPerformanceSignals(pose, now);
  const centerX = width * 0.5;
  const scale = Math.min(height * 0.27, width * 0.145) * animal.bodyScale;
  const isFeline = state.animalId === "cat" || state.animalId === "cheetah";
  const isLizard = state.animalId === "lizard";
  const isGiraffe = state.animalId === "giraffe";
  const bodyY = groundY - scale * ((isLizard ? 0.38 : 0.7) + pose.bodyLift * 0.38);
  const bodyWidth = scale * (state.animalId === "elephant" ? 1.45 : isLizard ? 1.65 : isFeline ? 1.48 : state.animalId === "gazelle" ? 1.28 : 1.34);
  const bodyHeight = scale * (state.animalId === "elephant" ? 0.76 : isLizard ? 0.3 : isFeline ? 0.46 : state.animalId === "gazelle" ? 0.5 : 0.58);
  const headSize = scale * (state.animalId === "elephant" ? 0.56 : isLizard ? 0.3 : isFeline ? 0.38 : 0.42);
  const headX = centerX + bodyWidth * (isGiraffe ? 0.48 : isLizard ? 0.62 : 0.58) + (isGiraffe ? performanceState.neckSway * scale * 0.16 : 0);
  const headY = isGiraffe
    ? bodyY - scale * 1.42 - pose.headLift * scale * 0.12
    : bodyY - bodyHeight * (isLizard ? 0.02 : 0.23) - pose.headLift * scale * (isLizard ? 0.06 : 0.2) + pose.headNod * scale * 0.12
      - performanceState.headToss * scale * 0.13;
  lastAnimalBounds = {
    x: centerX - bodyWidth * 0.66,
    y: headY - headSize,
    width: bodyWidth * 1.5,
    height: groundY - (headY - headSize),
  };

  const hips = {
    "rear-left": centerX - bodyWidth * 0.43,
    "rear-right": centerX - bodyWidth * 0.22,
    "front-left": centerX + bodyWidth * 0.25,
    "front-right": centerX + bodyWidth * 0.45,
  };
  drawLeg(context, "rear-left", hips["rear-left"], bodyY + bodyHeight * 0.22, groundY, scale, pose, animal.palette[1], true, now);
  drawLeg(context, "front-left", hips["front-left"], bodyY + bodyHeight * 0.2, groundY, scale, pose, animal.palette[1], true, now);

  context.save();
  context.translate(centerX, bodyY);
  const spineFlex = isFeline ? performanceState.spineFlex * 0.09 : 0;
  const bodyWave = isLizard ? Math.sin(pose.position / QUADRUPED_STEP_COUNT * Math.PI * 2) * 0.11 : 0;
  context.rotate(pose.bodyPitch + pose.bodyRoll * 0.22 - pose.rearBalance * 0.58 + spineFlex + bodyWave);
  context.fillStyle = animal.palette[0];
  context.strokeStyle = animal.palette[3];
  context.lineWidth = Math.max(2, scale * 0.027);
  context.shadowColor = "rgba(0, 0, 0, 0.35)";
  context.shadowBlur = scale * 0.16;
  context.beginPath();
  context.ellipse(0, 0, bodyWidth * 0.54, bodyHeight * 0.52, 0, 0, Math.PI * 2);
  context.fill();
  context.stroke();
  if (state.animalId === "gazelle") {
    context.fillStyle = animal.palette[2];
    context.beginPath();
    context.ellipse(0, bodyHeight * 0.2, bodyWidth * 0.42, bodyHeight * 0.12, 0, 0, Math.PI * 2);
    context.fill();
  }
  if (state.animalId === "cheetah") {
    context.fillStyle = animal.palette[3];
    context.globalAlpha = 0.72;
    for (let spot = 0; spot < 11; spot += 1) {
      const spotX = -bodyWidth * 0.39 + (spot % 6) * bodyWidth * 0.15;
      const spotY = -bodyHeight * 0.24 + Math.floor(spot / 6) * bodyHeight * 0.45;
      context.beginPath();
      context.arc(spotX, spotY, scale * (0.018 + (spot % 3) * 0.004), 0, Math.PI * 2);
      context.fill();
    }
    context.globalAlpha = 1;
  }
  if (state.animalId === "unicorn") {
    context.strokeStyle = animal.palette[2];
    context.lineWidth = scale * 0.055;
    context.beginPath();
    context.moveTo(-bodyWidth * 0.22, -bodyHeight * 0.46);
    context.bezierCurveTo(-bodyWidth * 0.03, -bodyHeight * 0.66, bodyWidth * 0.17, -bodyHeight * 0.52, bodyWidth * 0.37, -bodyHeight * 0.32);
    context.stroke();
  }
  context.restore();

  if (isGiraffe) {
    context.save();
    context.strokeStyle = animal.palette[3];
    context.lineWidth = scale * 0.25;
    context.lineCap = "round";
    context.beginPath();
    context.moveTo(centerX + bodyWidth * 0.38, bodyY - bodyHeight * 0.22);
    context.quadraticCurveTo(headX - scale * 0.24, bodyY - scale * 0.78, headX - headSize * 0.12, headY + headSize * 0.25);
    context.stroke();
    context.strokeStyle = animal.palette[0];
    context.lineWidth = scale * 0.19;
    context.stroke();
    context.restore();
  }

  const tailStartX = centerX - bodyWidth * 0.52;
  const tailStartY = bodyY - bodyHeight * 0.12;
  const tailManual = impulseStrength("tail", now);
  const tailAngle = pose.tailAngle + tailManual * 0.7;
  context.save();
  context.strokeStyle = state.animalId === "unicorn" ? animal.palette[2] : animal.palette[1];
  context.lineWidth = Math.max(3, scale * (state.animalId === "elephant" ? 0.065 : 0.04));
  context.lineCap = "round";
  context.beginPath();
  context.moveTo(tailStartX, tailStartY);
  context.bezierCurveTo(
    tailStartX - scale * 0.32,
    tailStartY - Math.sin(tailAngle) * scale * 0.42,
    tailStartX - scale * 0.5,
    tailStartY + Math.cos(tailAngle) * scale * 0.34,
    tailStartX - scale * (isLizard ? 1.28 : isFeline ? 0.9 : 0.62),
    tailStartY + Math.sin(tailAngle) * scale * (isLizard ? 0.28 : 0.48),
  );
  context.stroke();
  context.restore();

  drawLeg(context, "rear-right", hips["rear-right"], bodyY + bodyHeight * 0.24, groundY, scale, pose, animal.palette[0], false, now);
  drawLeg(context, "front-right", hips["front-right"], bodyY + bodyHeight * 0.21, groundY, scale, pose, animal.palette[0], false, now);

  context.save();
  context.fillStyle = animal.palette[0];
  context.strokeStyle = animal.palette[3];
  context.lineWidth = Math.max(2, scale * 0.027);
  if (state.animalId === "elephant") {
    context.beginPath();
    context.ellipse(headX - headSize * 0.25, headY, headSize * 0.64, headSize * 0.7, -0.15, 0, Math.PI * 2);
    context.fill();
    context.stroke();
    context.fillStyle = animal.palette[1];
    context.globalAlpha = 0.86;
    context.beginPath();
    context.ellipse(headX - headSize * 0.52, headY - headSize * 0.04, headSize * 0.48, headSize * 0.58, -0.25, 0, Math.PI * 2);
    context.fill();
    context.globalAlpha = 1;
    // The trumpet phrase performs a visible trunk-lift from its resting curve.
    const trunkRaise = clamp(performanceState.trunkRaise);
    const trunkTipX = headX + headSize * lerp(0.48, 0.26, trunkRaise);
    const trunkTipY = headY + headSize * lerp(1.04, -1.42, trunkRaise);
    context.lineCap = "round";
    const traceTrunk = () => {
      context.beginPath();
      context.moveTo(headX + headSize * 0.1, headY + headSize * 0.3);
      context.bezierCurveTo(
        headX + headSize * lerp(0.38, 0.5, trunkRaise),
        headY + headSize * lerp(0.76, 0.04, trunkRaise),
        headX + headSize * lerp(0.17, 0.58, trunkRaise),
        headY + headSize * lerp(1.14, -0.82, trunkRaise),
        trunkTipX,
        trunkTipY,
      );
    };
    context.strokeStyle = animal.palette[3];
    context.lineWidth = headSize * 0.29;
    traceTrunk();
    context.stroke();
    context.strokeStyle = animal.palette[0];
    context.lineWidth = headSize * 0.22;
    traceTrunk();
    context.stroke();
    context.fillStyle = animal.palette[0];
    context.strokeStyle = animal.palette[3];
    context.lineWidth = Math.max(1.5, headSize * 0.035);
    context.beginPath();
    context.ellipse(trunkTipX, trunkTipY, headSize * 0.14, headSize * 0.1, -0.25, 0, Math.PI * 2);
    context.fill();
    context.stroke();
    context.fillStyle = animal.palette[3];
    context.beginPath();
    context.arc(trunkTipX + headSize * 0.045, trunkTipY - headSize * 0.018, headSize * 0.027, 0, Math.PI * 2);
    context.fill();
    if (trunkRaise > 0.02) {
      context.save();
      context.globalAlpha = 0.28 + trunkRaise * 0.68;
      context.strokeStyle = animal.palette[2];
      context.lineWidth = Math.max(1.5, headSize * 0.055);
      context.shadowColor = animal.palette[2];
      context.shadowBlur = headSize * 0.22;
      for (let ray = -1; ray <= 1; ray += 1) {
        context.beginPath();
        context.moveTo(trunkTipX, trunkTipY);
        context.quadraticCurveTo(
          trunkTipX + headSize * (0.26 + ray * 0.13),
          trunkTipY - headSize * (0.2 + Math.abs(ray) * 0.08),
          trunkTipX + headSize * (0.48 + ray * 0.2),
          trunkTipY - headSize * (0.42 + Math.abs(ray) * 0.12),
        );
        context.stroke();
      }
      context.restore();
    }
    context.strokeStyle = animal.palette[4];
    context.lineWidth = headSize * 0.07;
    context.beginPath();
    context.moveTo(headX + headSize * 0.15, headY + headSize * 0.35);
    context.quadraticCurveTo(headX + headSize * 0.43, headY + headSize * 0.44, headX + headSize * 0.52, headY + headSize * 0.23);
    context.stroke();
    drawEyeAndMouth(context, headX - headSize * 0.19, headY, headSize, pose);
  } else {
    context.beginPath();
    context.ellipse(headX, headY, headSize * 0.48, headSize * 0.64, -0.36, 0, Math.PI * 2);
    context.fill();
    context.stroke();
    if (!isLizard) {
      context.fillStyle = animal.palette[1];
      context.beginPath();
      context.moveTo(headX - headSize * 0.2, headY - headSize * 0.46);
      context.lineTo(headX - headSize * 0.36, headY - headSize * 0.88);
      context.lineTo(headX + headSize * 0.02, headY - headSize * 0.58);
      context.closePath();
      context.fill();
    }
    if (state.animalId === "unicorn") {
      const hornPulse = clamp(performanceState.hornPulse);
      const hornTipX = headX + headSize * (0.35 + hornPulse * 0.15);
      const hornTipY = headY - headSize * (1.36 + hornPulse * 0.34);
      context.fillStyle = animal.palette[4];
      context.beginPath();
      context.moveTo(headX + headSize * 0.08, headY - headSize * 0.55);
      context.lineTo(hornTipX, hornTipY);
      context.lineTo(headX + headSize * 0.31, headY - headSize * 0.48);
      context.closePath();
      context.fill();
      context.strokeStyle = animal.palette[2];
      context.lineWidth = headSize * 0.09;
      context.beginPath();
      context.moveTo(headX - headSize * 0.36, headY - headSize * 0.4);
      context.bezierCurveTo(headX - headSize * 0.65, headY - headSize * 0.12, headX - headSize * 0.44, headY + headSize * 0.38, headX - headSize * 0.67, headY + headSize * 0.58);
      context.stroke();

      // A real muzzle and nostril give the fantasy animal somewhere to neigh and sneeze.
      const muzzleX = headX + headSize * 0.31;
      const muzzleY = headY + headSize * 0.2;
      context.fillStyle = animal.palette[0];
      context.strokeStyle = animal.palette[3];
      context.lineWidth = Math.max(1.5, headSize * 0.025);
      context.beginPath();
      context.ellipse(muzzleX, muzzleY, headSize * 0.38, headSize * 0.25, -0.12, 0, Math.PI * 2);
      context.fill();
      context.stroke();
      context.fillStyle = "#07100f";
      context.beginPath();
      context.ellipse(muzzleX + headSize * 0.21, muzzleY - headSize * 0.035, headSize * 0.052, headSize * 0.035, -0.18, 0, Math.PI * 2);
      context.fill();
      if (performanceState.strength > 0.02) {
        context.save();
        context.globalAlpha = 0.25 + performanceState.strength * 0.7;
        context.strokeStyle = animal.palette[2];
        context.lineWidth = Math.max(1.2, headSize * 0.035);
        context.shadowColor = animal.palette[2];
        context.shadowBlur = headSize * 0.24;
        for (let mark = 0; mark < 3; mark += 1) {
          context.beginPath();
          context.moveTo(muzzleX + headSize * 0.38, muzzleY + (mark - 1) * headSize * 0.08);
          context.quadraticCurveTo(
            muzzleX + headSize * (0.55 + mark * 0.07),
            muzzleY + (mark - 1) * headSize * 0.15,
            muzzleX + headSize * (0.7 + mark * 0.08),
            muzzleY + (mark - 1) * headSize * 0.2,
          );
          context.stroke();
        }
        context.beginPath();
        context.arc(hornTipX, hornTipY, headSize * (0.11 + hornPulse * 0.13), -0.35, Math.PI * 1.15);
        context.stroke();
        context.restore();
      }
    } else if (state.animalId === "gazelle") {
      const headToss = clamp(performanceState.headToss);
      const earFlick = clamp(performanceState.earFlick);
      context.fillStyle = animal.palette[1];
      context.beginPath();
      context.moveTo(headX + headSize * 0.03, headY - headSize * 0.5);
      context.lineTo(headX + headSize * (0.28 + earFlick * 0.08), headY - headSize * (0.9 + earFlick * 0.16));
      context.lineTo(headX + headSize * 0.3, headY - headSize * 0.48);
      context.closePath();
      context.fill();
      context.strokeStyle = animal.palette[3];
      context.lineWidth = Math.max(2, headSize * 0.06);
      context.beginPath();
      context.moveTo(headX - headSize * 0.18, headY - headSize * 0.5);
      context.bezierCurveTo(headX - headSize * (0.34 + headToss * 0.08), headY - headSize * 1.15, headX - headSize * 0.1, headY - headSize * (1.34 + headToss * 0.12), headX - headSize * (0.42 + headToss * 0.12), headY - headSize * (1.72 + headToss * 0.24));
      context.moveTo(headX + headSize * 0.05, headY - headSize * 0.54);
      context.bezierCurveTo(headX + headSize * (0.18 + headToss * 0.08), headY - headSize * 1.12, headX + headSize * 0.43, headY - headSize * (1.28 + headToss * 0.12), headX + headSize * (0.2 + headToss * 0.12), headY - headSize * (1.7 + headToss * 0.24));
      context.stroke();
      // Six-note marimba-string phrases drive the gazelle head-toss marks.
      if (headToss > 0.02) {
        context.save();
        context.globalAlpha = 0.3 + headToss * 0.65;
        context.strokeStyle = animal.palette[2];
        context.lineWidth = Math.max(1.2, headSize * 0.035);
        for (const direction of [-1, 1]) {
          context.beginPath();
          context.moveTo(headX + direction * headSize * 0.25, headY - headSize * (1.76 + headToss * 0.2));
          context.lineTo(headX + direction * headSize * (0.46 + earFlick * 0.12), headY - headSize * (1.94 + headToss * 0.26));
          context.stroke();
        }
        context.restore();
      }
    }
    if (isFeline) {
      const whiskerPulse = clamp(performanceState.whiskerPulse);
      context.fillStyle = animal.palette[1];
      context.beginPath();
      context.moveTo(headX + headSize * 0.02, headY - headSize * 0.5);
      context.lineTo(headX + headSize * 0.28, headY - headSize * 0.94);
      context.lineTo(headX + headSize * 0.36, headY - headSize * 0.42);
      context.closePath();
      context.fill();
      context.fillStyle = animal.palette[4];
      context.beginPath();
      context.ellipse(headX + headSize * 0.34, headY + headSize * 0.2, headSize * 0.3, headSize * 0.2, -0.08, 0, Math.PI * 2);
      context.fill();
      context.strokeStyle = animal.palette[4];
      context.lineWidth = Math.max(1, headSize * 0.025);
      for (const side of [-1, 1]) {
        for (let whisker = 0; whisker < 3; whisker += 1) {
          context.beginPath();
          context.moveTo(headX + headSize * 0.35, headY + side * headSize * (0.12 + whisker * 0.06));
          context.lineTo(headX + headSize * (0.72 + whiskerPulse * 0.22), headY + side * headSize * (0.14 + whisker * 0.1));
          context.stroke();
        }
      }
      if (state.animalId === "cheetah") {
        context.fillStyle = animal.palette[3];
        context.beginPath();
        context.arc(headX - headSize * 0.08, headY - headSize * 0.04, headSize * 0.055, 0, Math.PI * 2);
        context.arc(headX + headSize * 0.18, headY - headSize * 0.14, headSize * 0.045, 0, Math.PI * 2);
        context.fill();
        context.strokeStyle = animal.palette[3];
        context.lineWidth = Math.max(1, headSize * 0.035);
        context.beginPath();
        context.moveTo(headX + headSize * 0.18, headY - headSize * 0.04);
        context.lineTo(headX + headSize * 0.28, headY + headSize * 0.26);
        context.stroke();
      }
    }
    if (isGiraffe) {
      context.strokeStyle = animal.palette[1];
      context.lineWidth = Math.max(2, headSize * 0.1);
      context.lineCap = "round";
      for (const side of [-1, 1]) {
        context.beginPath();
        context.moveTo(headX + side * headSize * 0.18, headY - headSize * 0.5);
        context.lineTo(headX + side * headSize * 0.2, headY - headSize * 0.94);
        context.stroke();
        context.fillStyle = animal.palette[1];
        context.beginPath();
        context.arc(headX + side * headSize * 0.2, headY - headSize * 0.98, headSize * 0.1, 0, Math.PI * 2);
        context.fill();
      }
      context.fillStyle = animal.palette[4];
      context.beginPath();
      context.ellipse(headX + headSize * 0.34, headY + headSize * 0.2, headSize * 0.36, headSize * 0.2, -0.1, 0, Math.PI * 2);
      context.fill();
    }
    if (isLizard) {
      context.fillStyle = animal.palette[4];
      context.beginPath();
      context.ellipse(headX + headSize * 0.35, headY + headSize * 0.05, headSize * 0.55, headSize * 0.28, 0, 0, Math.PI * 2);
      context.fill();
      const tongue = clamp(performanceState.tongueFlick);
      if (tongue > 0.04) {
        context.strokeStyle = animal.palette[4];
        context.lineWidth = Math.max(1.5, headSize * 0.05);
        context.beginPath();
        context.moveTo(headX + headSize * 0.78, headY + headSize * 0.06);
        context.lineTo(headX + headSize * (0.92 + tongue * 0.5), headY + headSize * 0.04);
        context.lineTo(headX + headSize * (1.03 + tongue * 0.5), headY - headSize * 0.06);
        context.moveTo(headX + headSize * (0.92 + tongue * 0.5), headY + headSize * 0.04);
        context.lineTo(headX + headSize * (1.03 + tongue * 0.5), headY + headSize * 0.14);
        context.stroke();
      }
    }
    drawEyeAndMouth(context, headX, headY, headSize, pose);
  }
  context.restore();
  drawHeadAura(context, headX, headY, headSize, pose, performanceState);
}

function drawScene(now) {
  const { width, height } = canvasMetrics;
  if (width <= 1 || height <= 1) return;
  const motorSnapshot = transportPlaying
    ? materializeMotor(now)
    : quadrupedMotorSnapshot(state, motor);
  const position = transportPlaying ? motorSnapshot.position : selectedStep + 0.08;
  const pose = deriveQuadrupedPose(state, position, transportPlaying ? motorSnapshot : null);
  const animal = quadrupedAnimal(state.animalId);
  canvas.dataset.frame = String(pose.step);
  canvas.dataset.framePhase = pose.phase.toFixed(4);
  canvas.dataset.motorVelocity = motorSnapshot.velocity.toFixed(4);
  canvas.dataset.support = String(motorSnapshot.supportCount);
  canvas.dataset.airborne = String(motorSnapshot.airborne);
  const gradient = drawing.createLinearGradient(0, 0, width, height);
  gradient.addColorStop(0, "#07110f");
  gradient.addColorStop(0.6, state.animalId === "unicorn" ? "#181128" : ["gazelle", "cheetah", "giraffe"].includes(state.animalId) ? "#20170d" : state.animalId === "lizard" ? "#102117" : "#172019");
  gradient.addColorStop(1, "#050a09");
  drawing.fillStyle = gradient;
  drawing.fillRect(0, 0, width, height);

  drawing.save();
  drawing.globalAlpha = state.animalId === "unicorn" ? 0.32 : state.animalId === "cheetah" ? 0.24 : 0.16;
  drawing.fillStyle = animal.palette[2];
  const moteCount = compactMedia?.matches ? 18 : 34;
  for (let index = 0; index < moteCount; index += 1) {
    const x = mod(index * 97.31 + now * (state.animalId === "gazelle" ? 0.018 : 0.006), width);
    const y = mod(index * 53.17 + Math.sin(index * 2.3) * 40, height * 0.56);
    const radius = 0.7 + (index % 4) * 0.45;
    drawing.beginPath();
    drawing.arc(x, y, radius, 0, Math.PI * 2);
    drawing.fill();
  }
  drawing.restore();

  const groundY = height * 0.74;
  const stageAnimalScale = Math.min(height * 0.27, width * 0.145) * animal.bodyScale;
  const stanceSteps = quadrupedBehavior(state.behaviorId).stanceSteps;
  const tileWidth = clamp(stageAnimalScale * state.stride * 0.62 / Math.max(1.4, stanceSteps), 7, 24);
  const visibleRadius = Math.ceil(width / tileWidth / 2) + 2;
  const groundCenterX = width * 0.5;
  const activeStep = pose.step;
  drawing.fillStyle = "rgba(0, 0, 0, 0.28)";
  drawing.fillRect(0, groundY - 2, width, height - groundY + 2);
  lastTerrainHits = [];
  drawing.save();
  drawing.beginPath();
  drawing.rect(0, groundY, width, height - groundY);
  drawing.clip();
  for (let offset = -visibleRadius; offset <= visibleRadius; offset += 1) {
    const step = mod(activeStep + offset, QUADRUPED_STEP_COUNT);
    const tileX = groundCenterX + (offset - pose.phase) * tileWidth - tileWidth * 0.5;
    if (tileX + tileWidth < 0 || tileX > width) continue;
    const active = offset === 0;
    drawTerrainTile(
      drawing,
      quadrupedTerrain(state.terrain[step]),
      tileX,
      groundY,
      tileWidth,
      height - groundY - 10,
      active,
      step,
    );
    drawStepContactNotes(drawing, step, tileX, groundY, tileWidth, height - groundY - 10, active);
    drawing.save();
    drawing.globalAlpha = active ? 1 : 0.66;
    drawing.fillStyle = "#f4fff9";
    drawing.font = `700 ${Math.max(8, height * 0.018)}px ui-monospace, monospace`;
    drawing.textAlign = "center";
    drawing.fillText(String(step + 1), tileX + tileWidth * 0.5, height - 15);
    drawing.restore();
    lastTerrainHits.push({
      x: Math.max(0, tileX),
      width: Math.min(width, tileX + tileWidth) - Math.max(0, tileX),
      step,
      active,
    });
  }
  drawing.restore();
  drawing.save();
  drawing.strokeStyle = "rgba(255, 255, 255, 0.45)";
  drawing.lineWidth = 1;
  drawing.setLineDash([3, 5]);
  drawing.beginPath();
  drawing.moveTo(groundCenterX, groundY - height * 0.045);
  drawing.lineTo(groundCenterX, groundY + height * 0.055);
  drawing.stroke();
  drawing.restore();
  drawAnimal(drawing, pose, width, height, groundY, now);

  const step = pose.step;
  syncGridPlayhead(transportPlaying ? step : -1);
  updateStageReadouts(step);
  const performedHead = manualHeadSignals(now) ?? (transportPlaying ? pose.headPerformance : null);
  if (performedHead?.strength > 0.02) {
    setOutput($("headReadout"), headLabel(performedHead));
    headReadoutPerformanceActive = true;
  } else if (headReadoutPerformanceActive) {
    headReadoutPerformanceActive = false;
    updateStageReadouts(step, true);
  }
}

function animationLoop(now) {
  if (!pageActive) return;
  const snapshot = transportPlaying ? materializeMotor(now) : quadrupedMotorSnapshot(state, motor);
  canvas.dataset.frame = String(snapshot.frame);
  canvas.dataset.framePhase = snapshot.phase.toFixed(4);
  canvas.dataset.motorVelocity = snapshot.velocity.toFixed(4);
  canvas.dataset.support = String(snapshot.supportCount);
  canvas.dataset.airborne = String(snapshot.airborne);
  const cadence = Math.round(snapshot.velocity / QUADRUPED_STEP_COUNT * 60);
  const presentation = `${transportPlaying}:${snapshot.stalled}:${snapshot.airborne}:${cadence}`;
  if (presentation !== lastMotorPresentation) {
    lastMotorPresentation = presentation;
    syncTransportPresentation();
  }
  if (transportPlaying) {
    syncGridPlayhead(snapshot.frame);
    updateStageReadouts(snapshot.frame);
  }
  const frameInterval = compactMedia?.matches || reducedMotion ? 1_000 / 30 : 1_000 / 60;
  if (stageVisible && now - lastPaintTime >= frameInterval - 1) {
    lastPaintTime = now;
    drawScene(now);
  }
  animationFrame = requestAnimationFrame(animationLoop);
}

function resizeCanvas() {
  const bounds = stageWrap.getBoundingClientRect();
  const width = Math.max(1, Math.round(bounds.width));
  const height = Math.max(1, Math.round(bounds.height));
  const requestedDpr = Math.min(globalThis.devicePixelRatio || 1, compactMedia?.matches ? 1.35 : 2);
  const pixelBudget = compactMedia?.matches ? 720_000 : 1_500_000;
  const budgetDpr = Math.sqrt(pixelBudget / Math.max(1, width * height));
  const dpr = Math.max(1, Math.min(requestedDpr, budgetDpr));
  const pixelWidth = Math.max(1, Math.round(width * dpr));
  const pixelHeight = Math.max(1, Math.round(height * dpr));
  if (canvas.width !== pixelWidth || canvas.height !== pixelHeight) {
    canvas.width = pixelWidth;
    canvas.height = pixelHeight;
  }
  drawing.setTransform(dpr, 0, 0, dpr, 0, 0);
  canvasMetrics = Object.freeze({ width, height, dpr });
  drawScene(performance.now());
}

function canvasPoint(event) {
  const bounds = canvas.getBoundingClientRect();
  return {
    x: (event.clientX - bounds.left) / Math.max(1, bounds.width) * canvasMetrics.width,
    y: (event.clientY - bounds.top) / Math.max(1, bounds.height) * canvasMetrics.height,
  };
}

function handleCanvasPointerDown(event) {
  if (event.button !== 0) return;
  const point = canvasPoint(event);
  canvasPointer = { id: event.pointerId, x: point.x, y: point.y };
  canvas.setPointerCapture?.(event.pointerId);
}

function handleCanvasPointerEnd(event) {
  if (!canvasPointer || canvasPointer.id !== event.pointerId) return;
  const start = canvasPointer;
  canvasPointer = null;
  canvas.releasePointerCapture?.(event.pointerId);
  if (event.type === "pointercancel") return;
  const point = canvasPoint(event);
  if (Math.hypot(point.x - start.x, point.y - start.y) > 12) return;
  if (
    lastAnimalBounds
    && point.x >= lastAnimalBounds.x
    && point.x <= lastAnimalBounds.x + lastAnimalBounds.width
    && point.y >= lastAnimalBounds.y
    && point.y <= lastAnimalBounds.y + lastAnimalBounds.height * 0.55
  ) {
    triggerManualHead($("padGrid").querySelector("[data-head-trigger]"));
    return;
  }
  const terrainHit = lastTerrainHits.find((hit) => point.x >= hit.x && point.x <= hit.x + hit.width);
  const step = terrainHit?.step ?? selectedStep;
  if (point.y >= canvasMetrics.height * 0.7) editTerrain(step, event.shiftKey ? -1 : 1);
  else setSelectedStep(step, { announceStep: true });
}

function handleCanvasKeydown(event) {
  if (event.repeat) return;
  if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
    event.preventDefault();
    setSelectedStep(selectedStep + (event.key === "ArrowLeft" ? -1 : 1), { announceStep: true });
    return;
  }
  if (/^[1-5]$/.test(event.key)) {
    event.preventDefault();
    const lane = QUADRUPED_LANES[Number(event.key) - 1];
    editContact(lane.id, selectedStep, event.shiftKey ? -1 : 1);
    return;
  }
  if (event.key === "Enter") {
    event.preventDefault();
    triggerManualHead($("padGrid").querySelector("[data-head-trigger]"));
  }
}

function handleGlobalKeydown(event) {
  if (event.defaultPrevented || event.repeat || event.ctrlKey || event.altKey || event.metaKey) return;
  const target = event.target;
  if (target?.closest?.("input, select, textarea, button, a, summary, [contenteditable='true'], [role='slider'], [role='grid']")) return;
  if (!/^[1-5]$/.test(event.key)) return;
  event.preventDefault();
  const button = $("padGrid").querySelector(`[data-pad-index="${Number(event.key) - 1}"]`);
  button?.click();
}

function bindControls() {
  $("audioButton").addEventListener("click", toggleAudio);
  $("playButton").addEventListener("click", toggleTransport);
  $("restartButton").addEventListener("click", restartTransport);
  $("tempo").addEventListener("input", () => updateStateValue("tempoBpm", $("tempo").value));
  $("stride").addEventListener("input", () => updateStateValue("stride", $("stride").value));
  $("momentum").addEventListener("input", () => updateStateValue("momentum", $("momentum").value));
  $("gravity").addEventListener("input", () => updateStateValue("gravity", $("gravity").value));
  $("mood").addEventListener("input", () => updateStateValue("mood", $("mood").value));
  $("groundResonance").addEventListener("input", () => updateStateValue("groundResonance", $("groundResonance").value));
  $("level").addEventListener("input", () => updateStateValue("outputLevel", $("level").value));
  $("remixButton").addEventListener("click", () => {
    const now = performance.now();
    const position = currentPosition(now);
    state = mutateQuadrupedPattern(state);
    retimeTransport(position, now, { preserveMotion: true });
    if (transportPlaying && motor.velocity <= 0.012) wakeMotorAtFootfall(now);
    rememberMode();
    renderGridState();
    syncBehaviorReadouts();
    resetAudioSchedule();
    announce("The gait and ground were remixed within the body score.");
  });
  $("clearButton").addEventListener("click", () => {
    const now = performance.now();
    const position = currentPosition(now);
    state = clearQuadrupedPattern(state);
    retimeTransport(position, now, { preserveMotion: true });
    rememberMode();
    renderGridState();
    syncBehaviorReadouts();
    resetAudioSchedule();
    announce("Feet cleared. Stored momentum is coasting; the score will stall without another foot push.");
  });
  $("resetButton").addEventListener("click", () => {
    const next = createQuadrupedState(state.animalId, state.behaviorId);
    modeMemory.delete(modeKey());
    replaceState(next, { announceMessage: `${quadrupedAnimal(state.animalId).label} ${quadrupedBehavior(state.behaviorId).label} reset to its reproducible starting score.` });
  });
  document.querySelectorAll("[data-animal-id]").forEach((button) => {
    button.addEventListener("click", () => switchAnimal(button.dataset.animalId));
  });
  $("padGrid").querySelectorAll("[data-lane-id]").forEach((button) => {
    button.addEventListener("click", () => triggerManualLane(button.dataset.laneId, button));
  });
  $("padGrid").querySelector("[data-head-trigger]").addEventListener("click", (event) => triggerManualHead(event.currentTarget));
  canvas.addEventListener("pointerdown", handleCanvasPointerDown);
  canvas.addEventListener("pointerup", handleCanvasPointerEnd);
  canvas.addEventListener("pointercancel", handleCanvasPointerEnd);
  canvas.addEventListener("lostpointercapture", () => { canvasPointer = null; });
  canvas.addEventListener("keydown", handleCanvasKeydown);
  globalThis.addEventListener("keydown", handleGlobalKeydown);
}

async function teardown() {
  if (!pageActive) return;
  pageActive = false;
  if (animationFrame) cancelAnimationFrame(animationFrame);
  animationFrame = 0;
  stopAudioScheduler();
  resizeObserver?.disconnect();
  intersectionObserver?.disconnect();
  for (const timer of uiTimers) globalThis.clearTimeout(timer);
  uiTimers.clear();
  await closeAudio({ announceChange: false });
}

const resizeObserver = typeof ResizeObserver === "function"
  ? new ResizeObserver(resizeCanvas)
  : null;
const intersectionObserver = typeof IntersectionObserver === "function"
  ? new IntersectionObserver(([entry]) => {
    stageVisible = entry?.isIntersecting !== false;
    if (stageVisible) drawScene(performance.now());
  }, { rootMargin: "120px" })
  : null;

buildBehaviorButtons();
buildSequenceGrid();
bindControls();
syncAllControls();
setAudioPresentation("off");
resizeObserver?.observe(stageWrap);
intersectionObserver?.observe(stageWrap);
resizeCanvas();
animationFrame = requestAnimationFrame(animationLoop);

document.addEventListener("visibilitychange", () => {
  if (document.hidden) {
    if (transportPlaying) materializeMotor(performance.now());
    stopAudioScheduler();
    return;
  }
  motorPerformance = performance.now();
  if (graph && transportPlaying) resetAudioSchedule();
  drawScene(performance.now());
});
globalThis.addEventListener("pagehide", teardown, { once: true });

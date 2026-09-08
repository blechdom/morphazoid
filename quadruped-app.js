import {
  QUADRUPED_ANIMALS,
  QUADRUPED_GROUND_PROFILES,
  QUADRUPED_LANES,
  QUADRUPED_LIMITS,
  QUADRUPED_STEP_COUNT,
  QUADRUPED_TERRAINS,
  applyQuadrupedAnimal,
  applyQuadrupedBehavior,
  clearQuadrupedPattern,
  createQuadrupedState,
  cycleQuadrupedContact,
  deriveQuadrupedPose,
  describeQuadrupedStep,
  mutateQuadrupedPattern,
  quadrupedAnimal,
  quadrupedBehavior,
  quadrupedBehaviorFit,
  quadrupedBehaviorsForAnimal,
  quadrupedFootCycleState,
  quadrupedFootVoice,
  quadrupedGroundHeightAtWorldX,
  quadrupedGroundProfile,
  quadrupedSequenceEvent,
  quadrupedTerrain,
  sanitizeQuadrupedState,
  setQuadrupedContact,
  setQuadrupedGroundProfile,
  setQuadrupedSurface,
  solveQuadrupedLimbChain,
} from "./src/quadruped.js";
import {
  advanceQuadrupedMotor,
  createQuadrupedMotorState,
  kickQuadrupedMotor,
  predictQuadrupedMotor,
  quadrupedMotorSnapshot,
  synchronizeQuadrupedMotorTempo,
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
const groundProfileById = new Map(QUADRUPED_GROUND_PROFILES.map((profile) => [profile.id, profile]));
const lanePan = Object.freeze({
  "front-left": -0.5,
  "front-right": 0.5,
  "rear-left": -0.3,
  "rear-right": 0.3,
});
const NEW_ANIMAL_FOOT_AUDIO = Object.freeze({
  horse: Object.freeze({ front: 238, hind: 112, duration: 0.13, tone: "triangle", tonePeak: 0.17, noisePeak: 0.07, noiseFrequency: 2_400 }),
  dog: Object.freeze({ front: 310, hind: 142, duration: 0.075, tone: "sine", tonePeak: 0.12, noisePeak: 0.085, noiseFrequency: 3_600 }),
  goat: Object.freeze({ front: 390, hind: 184, duration: 0.095, tone: "square", tonePeak: 0.13, noisePeak: 0.075, noiseFrequency: 4_200 }),
  rabbit: Object.freeze({ front: 440, hind: 82, duration: 0.07, tone: "sine", tonePeak: 0.14, noisePeak: 0.045, noiseFrequency: 2_100 }),
  camel: Object.freeze({ front: 104, hind: 58, duration: 0.19, tone: "sine", tonePeak: 0.18, noisePeak: 0.08, noiseFrequency: 780 }),
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
const scheduledToeOffs = new Map();
let graph = null;
let audioStarting = null;
let pageActive = true;
let stageVisible = true;
let animationFrame = 0;
let lastPaintTime = -Infinity;
let lastPlayingStep = -1;
let lastReadoutStep = -1;
let canvasMetrics = Object.freeze({ width: 1, height: 1, dpr: 1 });
let canvasPointer = null;
let lastFootprintHits = [];
const activeSources = new Set();
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

function createMaterialBus(context, mixBus) {
  const input = context.createGain();
  const dryFilter = context.createBiquadFilter();
  const dryGain = context.createGain();
  const modes = Array.from({ length: 3 }, () => ({
    filter: context.createBiquadFilter(),
    gain: context.createGain(),
  }));
  dryFilter.type = "lowpass";
  input.connect(dryFilter);
  dryFilter.connect(dryGain);
  dryGain.connect(mixBus);
  for (const mode of modes) {
    mode.filter.type = "bandpass";
    input.connect(mode.filter);
    mode.filter.connect(mode.gain);
    mode.gain.connect(mixBus);
  }
  return { input, dryFilter, dryGain, modes };
}

function applyMaterialProfile(materialBus, terrain, when, immediate = false) {
  if (!materialBus || !terrain) return;
  const start = Math.max(0, Number(when) || 0);
  const settle = immediate ? 0.001 : 0.032;
  const baseFrequency = 82 * (2 ** (terrain.pitchOffset / 12));
  const cutoff = 520 + terrain.brightness * 15_000;
  const dryLevel = 0.5 + (1 - terrain.damping) * 0.34;
  const ratios = [1, 2.73, 6.48];
  const strengths = [0.14, 0.09, 0.055];
  for (const parameter of [materialBus.dryFilter.frequency, materialBus.dryGain.gain]) {
    parameter.cancelScheduledValues(start);
  }
  materialBus.dryFilter.frequency.setTargetAtTime(cutoff, start, settle);
  materialBus.dryGain.gain.setTargetAtTime(dryLevel, start, settle);
  materialBus.modes.forEach((mode, index) => {
    const frequency = clamp(baseFrequency * ratios[index] * (1 + terrain.hardness * index * 0.32), 45, 12_000);
    const q = 0.65 + terrain.reflection * (2.2 + index * 3.1);
    const level = strengths[index] * terrain.reflection * (0.66 + terrain.hardness * 0.34);
    for (const parameter of [mode.filter.frequency, mode.filter.Q, mode.gain.gain]) {
      parameter.cancelScheduledValues(start);
    }
    mode.filter.frequency.setTargetAtTime(frequency, start, settle);
    mode.filter.Q.setTargetAtTime(q, start, settle);
    mode.gain.gain.setTargetAtTime(level, start, settle);
  });
}

function createFlightVoice(context, mixBus, noiseBuffer) {
  const source = context.createBufferSource();
  const highpass = context.createBiquadFilter();
  const bandpass = context.createBiquadFilter();
  const gain = context.createGain();
  const panner = createPanner(context, 0);
  source.buffer = noiseBuffer;
  source.loop = true;
  highpass.type = "highpass";
  highpass.frequency.value = 100;
  bandpass.type = "bandpass";
  bandpass.frequency.value = 700;
  bandpass.Q.value = 0.7;
  gain.gain.value = 0;
  source.connect(highpass);
  highpass.connect(bandpass);
  bandpass.connect(gain);
  gain.connect(panner);
  panner.connect(mixBus);
  source.start();
  return { source, highpass, bandpass, gain, panner, active: false };
}

function silenceFlightVoice(releaseSeconds = 0.025) {
  const voice = graph?.flightVoice;
  if (!voice || !graph) return;
  const now = graph.context.currentTime;
  voice.gain.gain.cancelScheduledValues(now);
  voice.gain.gain.setValueAtTime(voice.gain.gain.value, now);
  voice.gain.gain.linearRampToValueAtTime(0, now + Math.max(0.006, releaseSeconds));
  voice.active = false;
}

function syncFlightVoice(snapshot) {
  const voice = graph?.flightVoice;
  if (!voice || !graph || !transportPlaying) {
    silenceFlightVoice();
    return;
  }
  const unsupported = snapshot.supportCount === 0;
  const now = graph.context.currentTime;
  if (!unsupported) {
    if (voice.active) silenceFlightVoice();
    return;
  }
  const speed = clamp(snapshot.normalizedVelocity / 1.25);
  const vertical = clamp(Math.abs(snapshot.verticalVelocity) / 6);
  const height = clamp(snapshot.height / 1.2);
  const energy = clamp(0.68 * speed + 0.2 * vertical + 0.12 * height);
  const level = 0.075 * energy ** 1.25;
  voice.active = true;
  voice.gain.gain.cancelScheduledValues(now);
  voice.gain.gain.setTargetAtTime(Math.max(0.0001, level), now, 0.018);
  voice.highpass.frequency.setTargetAtTime(80 + 420 * speed, now, 0.025);
  voice.bandpass.frequency.setTargetAtTime(450 + 2_800 * speed + 850 * vertical, now, 0.025);
  voice.bandpass.Q.setTargetAtTime(0.55 + 0.8 * height, now, 0.025);
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
  const noiseBuffer = createNoiseBuffer(context);
  const materialBus = createMaterialBus(context, mixBus);
  applyMaterialProfile(materialBus, quadrupedTerrain(state.surfaceId), context.currentTime, true);
  const flightVoice = createFlightVoice(context, mixBus, noiseBuffer);
  return {
    context,
    mixBus,
    compressor,
    masterGain,
    analyser,
    releaseOutput,
    noiseBuffer,
    materialBus,
    flightVoice,
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
  silenceFlightVoice(0.008);
  releaseAllSources();
  graph = null;
  try {
    closing.flightVoice?.source?.stop();
    for (const node of [
      closing.flightVoice?.source,
      closing.flightVoice?.highpass,
      closing.flightVoice?.bandpass,
      closing.flightVoice?.gain,
      closing.flightVoice?.panner,
      closing.materialBus?.input,
      closing.materialBus?.dryFilter,
      closing.materialBus?.dryGain,
      ...(closing.materialBus?.modes ?? []).flatMap((mode) => [mode.filter, mode.gain]),
    ]) node?.disconnect?.();
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
  panner.connect(role === "body" ? graph.materialBus?.input ?? mixBus : mixBus);
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
  panner.connect(role === "body" ? graph.materialBus?.input ?? mixBus : mixBus);
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
  const lane = laneById.get(contact.id);
  const laneIndex = lane?.index ?? 0;
  const pan = lanePan[contact.id] ?? 0;
  const amount = contact.intensity * normalization;
  const terrainRatio = 2 ** (terrain.pitchOffset / 36);
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

  const newAnimalProfile = NEW_ANIMAL_FOOT_AUDIO[state.animalId];
  if (newAnimalProfile) {
    const limbBase = isFront ? newAnimalProfile.front : newAnimalProfile.hind;
    const sideRatio = isLeft ? 0.94 : 1.07;
    const rabbitDrive = state.animalId === "rabbit" && !isFront ? 1.46 : 1;
    const camelPad = state.animalId === "camel" ? 1.28 : 1;
    scheduleTone({
      when,
      frequency: limbBase * sideRatio * terrainRatio,
      duration: (newAnimalProfile.duration + terrain.decay * 0.16) * resonance * camelPad,
      peak: newAnimalProfile.tonePeak * amount * rabbitDrive,
      pan,
      type: newAnimalProfile.tone,
      attack: state.animalId === "camel" ? 0.009 : 0.0025,
      startRatio: isFront ? 1.3 : 1.72,
      endRatio: state.animalId === "goat" ? 0.92 : 0.76,
      filterType: state.animalId === "camel" || state.animalId === "rabbit" ? "lowpass" : "bandpass",
      filterFrequency: limbBase * (state.animalId === "goat" ? 4.6 : 3.1) + terrain.brightness * 1_200,
      filterQ: state.animalId === "goat" ? 1.8 : 0.8,
    });
    scheduleNoise({
      when,
      duration: (state.animalId === "camel" ? 0.11 : 0.028) + terrain.roughness * 0.055,
      peak: newAnimalProfile.noisePeak * amount * (isFront ? 0.86 : 1.08),
      pan,
      filterType: state.animalId === "camel" ? "lowpass" : state.animalId === "dog" ? "highpass" : "bandpass",
      filterFrequency: newAnimalProfile.noiseFrequency + terrain.brightness * 1_600,
      filterQ: state.animalId === "goat" ? 2.2 : 0.75,
      offset: absoluteStep * 0.097 + laneIndex * 0.14,
    });
    return;
  }

  const base = (isFront ? (isLeft ? 520 : 690) : (isLeft ? 174 : 220)) * terrainRatio;
  const duration = (isFront ? 0.045 + terrain.decay * 0.09 : 0.12 + terrain.decay * 0.34) * resonance;
  scheduleTone({ when, frequency: base, duration, peak: (isFront ? 0.13 : 0.18) * amount, pan, type: isFront ? (isLeft ? "square" : "triangle") : "triangle", attack: 0.0015, startRatio: isFront ? (isLeft ? 1.08 : 1.28) : (isLeft ? 1.18 : 1.34), endRatio: isFront ? 0.95 : 0.9, filterType: "bandpass", filterFrequency: base * (isFront ? (isLeft ? 1.35 : 1.8) : 2.4), filterQ: isFront ? (isLeft ? 1.8 : 0.85) : 0.9 });
  if (!isFront) scheduleTone({ when: when + 0.003, frequency: base * (isLeft ? 3.0 : 3.96), duration: duration * (isLeft ? 0.58 : 0.42), peak: 0.05 * amount, pan, type: "sine", attack: 0.0015, startRatio: 1.02, endRatio: 0.96, filterType: "highpass", filterFrequency: 900, filterQ: 0.6 });
  scheduleNoise({ when, duration: (isFront ? 0.022 : 0.038) + terrain.decay * 0.035, peak: (isFront ? (isLeft ? 0.075 : 0.052) : 0.046) * amount, pan, filterType: "bandpass", filterFrequency: (isFront ? (isLeft ? 2_900 : 4_200) : 1_650) + terrain.brightness * 2_100, filterQ: isFront ? (isLeft ? 2.4 : 1.1) : 1.3, offset: absoluteStep * 0.079 + laneIndex * 0.11 });
}

function scheduleToeOff(transition, terrain, when) {
  const isFront = transition.laneId.startsWith("front");
  const motionEnergy = clamp(0.58 + (transition.velocity ?? 0) / 42, 0.48, 1);
  const amount = clamp(transition.intensity) * motionEnergy;
  scheduleNoise({
    when,
    duration: 0.018 + terrain.decay * 0.025,
    peak: (isFront ? 0.018 : 0.026) * amount,
    pan: lanePan[transition.laneId] ?? 0,
    filterType: "bandpass",
    filterFrequency: (isFront ? 2_600 : 1_250) + terrain.brightness * 1_600,
    filterQ: 1.4,
    offset: transition.position * 0.149 + (laneById.get(transition.laneId)?.index ?? 0) * 0.17,
  });
}

function scheduleStanceAccent(transition, terrain, when) {
  const isFront = transition.laneId.startsWith("front");
  const amount = clamp(transition.intensity) * clamp(0.55 + (transition.velocity ?? 0) / 48, 0.5, 1);
  if (transition.type === "load") {
    scheduleTone({
      when,
      frequency: (isFront ? 138 : 86) * (2 ** (terrain.pitchOffset / 36)),
      duration: 0.045 + terrain.decay * 0.07,
      peak: (isFront ? 0.032 : 0.046) * amount,
      pan: lanePan[transition.laneId] ?? 0,
      type: "sine",
      attack: 0.008,
      startRatio: 1.08,
      endRatio: 0.9,
      filterFrequency: 520 + terrain.brightness * 820,
      filterQ: 0.6,
    });
    return;
  }
  scheduleNoise({
    when,
    duration: 0.02 + terrain.roughness * 0.045,
    peak: (isFront ? 0.022 : 0.036) * amount,
    pan: lanePan[transition.laneId] ?? 0,
    filterType: terrain.id === "water" || terrain.id === "snow" ? "lowpass" : "bandpass",
    filterFrequency: (isFront ? 1_650 : 920) + terrain.brightness * 1_700,
    filterQ: 0.8 + terrain.hardness,
    offset: transition.position * 0.173 + (laneById.get(transition.laneId)?.index ?? 0) * 0.19,
  });
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
  const scoreEvent = quadrupedSequenceEvent(state, absoluteStep);
  const contacts = Array.isArray(motorEvent?.contacts) ? motorEvent.contacts : scoreEvent.contacts;
  const terrain = motorEvent?.terrain ?? scoreEvent.terrain;
  if (!contacts.length) return;
  const motionEnergy = clamp(0.58 + (motorEvent?.velocity ?? 0) / 42, 0.48, 1);
  const normalization = motionEnergy / Math.sqrt(Math.max(1, contacts.length));
  for (const contact of contacts) {
    scheduleFoot(contact, terrain, when, normalization, absoluteStep);
  }
  if (state.behaviorId === "skid") {
    scheduleNoise({
      when,
      duration: Math.min(0.4, 54 / state.tempoBpm),
      peak: 0.055 * normalization * (0.7 + terrain.roughness * 0.3),
      pan: -0.12,
      filterType: "bandpass",
      filterFrequency: 620 + terrain.brightness * 3_800,
      filterQ: 0.7 + terrain.hardness * 1.4,
      offset: absoluteStep * 0.037,
      role: "body",
    });
  }
}

function scheduleAudioWindow() {
  if (!graph || !transportPlaying || graph.context.state !== "running") return;
  const nowPerformance = performance.now();
  const snapshot = materializeMotor(nowPerformance);
  syncFlightVoice(snapshot);
  const prediction = predictQuadrupedMotor(state, motor, QUADRUPED_LIMITS.schedulerLookaheadSeconds);
  const audioNow = graph.context.currentTime;
  for (const [eventId, scheduledTime] of scheduledToeOffs) {
    if (scheduledTime < audioNow - 0.1) scheduledToeOffs.delete(eventId);
  }
  for (const transition of prediction.transitions) {
    if (!transition.eventId || scheduledToeOffs.has(transition.eventId)) continue;
    const when = audioNow + Math.max(0.006, transition.offsetSeconds);
    if (transition.type === "toe-off") scheduleToeOff(transition, quadrupedTerrain(state.surfaceId), when);
    else if (transition.type === "load" || transition.type === "push") scheduleStanceAccent(transition, quadrupedTerrain(state.surfaceId), when);
    else continue;
    scheduledToeOffs.set(transition.eventId, when);
  }
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
  scheduledToeOffs.clear();
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
      : `${actualCadence} BPM · ${snapshot.airborne ? "flight" : "driven"}`
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
  silenceFlightVoice();
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
  const targetAnimal = quadrupedAnimal(animalId);
  const key = `${targetAnimal.id}:${targetAnimal.defaultBehaviorId}`;
  const stored = modeMemory.get(key);
  const next = stored ?? applyQuadrupedAnimal(state, targetAnimal.id);
  replaceState({ ...next, tempoBpm: state.tempoBpm, outputLevel: state.outputLevel }, {
    announceMessage: `${targetAnimal.label} loaded. The global tempo and moving playhead stayed put.`,
  });
}

function switchBehavior(behaviorId) {
  if (behaviorId === state.behaviorId) return;
  rememberMode();
  const key = `${state.animalId}:${behaviorId}`;
  const stored = modeMemory.get(key);
  const next = stored ?? applyQuadrupedBehavior(state, behaviorId);
  replaceState({ ...next, tempoBpm: state.tempoBpm, outputLevel: state.outputLevel }, {
    announceMessage: `${quadrupedBehavior(behaviorId).label} loaded on the same global tempo.`,
  });
}

function updateStateValue(key, value) {
  const now = performance.now();
  const position = currentPosition(now);
  state = sanitizeQuadrupedState({ ...state, [key]: value }, state);
  retimeTransport(position, now, { preserveMotion: true });
  if (key === "tempoBpm") {
    motor = synchronizeQuadrupedMotorTempo(state, motor);
    stoppedPosition = motor.position;
  }
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
  if (transportPlaying && amount > 0 && motor.velocity <= 0.012) {
    wakeMotorAtFootfall(now, selectedStep, amount);
  }
  rememberMode();
  renderGridState();
  syncBehaviorReadouts();
  resetAudioSchedule();
  if (!transportPlaying && isAudioOn() && amount > 0) {
    const lane = laneById.get(laneId);
    const terrain = quadrupedTerrain(state.surfaceId);
    scheduleFoot({ ...lane, intensity: amount }, terrain, graph.context.currentTime + 0.008, 0.84, selectedStep);
  }
  announce(`${laneById.get(laneId)?.label ?? laneId}, step ${selectedStep + 1}: ${contactLevelName(amount)}.`);
}

function setSurface(surfaceId) {
  const now = performance.now();
  const position = currentPosition(now);
  state = setQuadrupedSurface(state, surfaceId);
  if (graph) applyMaterialProfile(graph.materialBus, quadrupedTerrain(state.surfaceId), graph.context.currentTime);
  retimeTransport(position, now, { preserveMotion: true });
  rememberMode();
  resetAudioSchedule();
  syncAllControls({ grid: false });
  updateStageReadouts(selectedStep, true);
  announce(`${quadrupedTerrain(state.surfaceId).label} now covers the whole contact field.`);
}

function setGroundProfile(groundProfileId) {
  const now = performance.now();
  const position = currentPosition(now);
  state = setQuadrupedGroundProfile(state, groundProfileId);
  retimeTransport(position, now, { preserveMotion: true });
  rememberMode();
  resetAudioSchedule();
  syncAllControls({ grid: true });
  const profile = quadrupedGroundProfile(state.groundProfileId);
  announce(`${profile.label}. The current stance relatches to this course; each new touchdown keeps its tread until lift-off.`);
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
  const pose = deriveQuadrupedPose(state, step + 0.0001);
  const animal = quadrupedAnimal(state.animalId);
  const morphology = animal.morphology;
  const ink = "#402f22";
  const fadedInk = "rgba(64, 47, 34, 0.48)";
  const groundY = height - 17;
  const bodyY = groundY - 31 * morphology.clearance - pose.bodyLift * 7;
  const bodyWidth = 20 * morphology.bodyWidth;
  const bodyHeight = 18 * morphology.bodyHeight;
  const miniRotation = pose.bodyPitch + pose.bodyRoll * 0.22 - pose.rearBalance * 0.58
    - pose.forwardRoll * Math.PI * 2;
  const bodyPoint = (localX, localY) => ({
    x: 52 + localX * Math.cos(miniRotation) - localY * Math.sin(miniRotation),
    y: bodyY + localX * Math.sin(miniRotation) + localY * Math.cos(miniRotation),
  });

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
  for (let x = 6; x <= width - 6; x += 2) {
    const worldX = pose.event.step / QUADRUPED_STEP_COUNT * state.stride + (x - 52) / 31;
    const worldY = quadrupedGroundHeightAtWorldX(state.groundProfileId, worldX);
    const screenY = groundY - (worldY - pose.bodyGroundHeight) * 31;
    if (x === 6) context.moveTo(x, screenY);
    else context.lineTo(x, screenY);
  }
  context.stroke();

  const hips = Object.freeze({
    "rear-left": bodyPoint(-bodyWidth * 0.43, bodyHeight * 0.22 * morphology.haunch),
    "rear-right": bodyPoint(-bodyWidth * 0.37, bodyHeight * 0.24 * morphology.haunch),
    "front-left": bodyPoint(bodyWidth * 0.37, bodyHeight * 0.2 * morphology.shoulder),
    "front-right": bodyPoint(bodyWidth * 0.43, bodyHeight * 0.22 * morphology.shoulder),
  });
  const drawMiniLeg = (laneId, far) => {
    const leg = pose.legs[laneId];
    const hipX = hips[laneId].x;
    const hipY = hips[laneId].y;
    const isFront = laneId.startsWith("front");
    const groundHoofX = 52 + leg.footX * 31;
    const groundHoofY = groundY - (leg.footWorldY - pose.bodyGroundHeight) * 31 - leg.lift * 17;
    const farSpread = laneId.endsWith("left") ? -2.5 : 2.5;
    const hoofX = lerp(groundHoofX, hipX + (isFront ? -5 : 5) + farSpread, pose.rollTuck);
    const hoofY = lerp(groundHoofY, hipY + 7 + farSpread, pose.rollTuck);
    const upper = 31 * (isFront ? morphology.frontUpper : morphology.hindUpper);
    const lower = 31 * (isFront ? morphology.frontLower : morphology.hindLower);
    const distal = 31 * morphology.distal;
    const digitigrade = ["feline", "canid", "rabbit"].includes(morphology.family);
    const bend = isFront ? morphology.foreBend : morphology.hindBend;
    const chain = solveQuadrupedLimbChain(
      hipX,
      hipY,
      hoofX,
      hoofY,
      upper,
      lower,
      distal,
      bend,
      isFront ? -0.025 : digitigrade ? 0.09 : 0.035,
      -1,
    );
    context.save();
    context.globalAlpha = far ? 0.48 : 1;
    context.strokeStyle = ink;
    context.lineWidth = Math.max(2, 31 * morphology.legWidth);
    context.lineCap = "round";
    context.lineJoin = "round";
    context.beginPath();
    context.moveTo(hipX, hipY);
    context.lineTo(chain.kneeX, chain.kneeY);
    context.lineTo(chain.ankleX, chain.ankleY);
    context.lineTo(chain.footX, chain.footY);
    context.stroke();
    context.strokeStyle = laneById.get(laneId).color;
    context.lineWidth = Math.max(2.4, 31 * morphology.footWidth * 0.8);
    context.beginPath();
    context.moveTo(chain.footX - 2, chain.footY);
    context.lineTo(chain.footX + 2.5, chain.footY);
    context.stroke();
    context.restore();
  };
  drawMiniLeg("rear-left", true);
  drawMiniLeg("front-left", true);

  context.fillStyle = "rgba(64, 47, 34, 0.13)";
  context.strokeStyle = ink;
  context.lineWidth = 2;
  context.save();
  context.translate(52, bodyY);
  context.rotate(miniRotation);
  context.beginPath();
  context.moveTo(-bodyWidth * 0.53, 0);
  context.bezierCurveTo(-bodyWidth * 0.46, -bodyHeight * 0.56, bodyWidth * 0.22, -bodyHeight * 0.56, bodyWidth * 0.53, 0);
  context.bezierCurveTo(bodyWidth * 0.48, bodyHeight * 0.52, -bodyWidth * 0.38, bodyHeight * 0.54, -bodyWidth * 0.53, 0);
  context.closePath();
  context.fill();
  context.stroke();
  if (morphology.family === "camel") {
    context.beginPath();
    context.moveTo(-bodyWidth * 0.43, -bodyHeight * 0.4);
    context.bezierCurveTo(-bodyWidth * 0.38, -bodyHeight * 1.03, -bodyWidth * 0.14, -bodyHeight * 1.03, -bodyWidth * 0.04, -bodyHeight * 0.4);
    context.bezierCurveTo(bodyWidth * 0.06, -bodyHeight * 1, bodyWidth * 0.31, -bodyHeight * 0.98, bodyWidth * 0.42, -bodyHeight * 0.36);
    context.closePath();
    context.fill();
    context.stroke();
  }
  if (morphology.family === "giraffe") {
    context.fillStyle = ink;
    context.globalAlpha = 0.66;
    for (const [spotX, spotY, radiusX, radiusY] of [
      [-0.34, -0.18, 0.09, 0.13], [-0.12, 0.14, 0.08, 0.1],
      [0.08, -0.2, 0.1, 0.11], [0.31, 0.12, 0.08, 0.13],
    ]) {
      context.beginPath();
      context.ellipse(bodyWidth * spotX, bodyHeight * spotY, bodyWidth * radiusX, bodyHeight * radiusY, spotX, 0, Math.PI * 2);
      context.fill();
    }
    context.globalAlpha = 1;
  }
  context.restore();
  if (state.animalId === "cheetah") {
    context.fillStyle = ink;
    for (let spot = 0; spot < 5; spot += 1) {
      context.beginPath();
      context.arc(39 + spot * 7, bodyY + (spot % 2 ? 2 : -2), 1, 0, Math.PI * 2);
      context.fill();
    }
  }
  context.strokeStyle = ink;
  context.lineWidth = morphology.family === "elephant" ? 3.5 : 2;
  const miniTailRoot = bodyPoint(-bodyWidth * 0.52, -bodyHeight * 0.12);
  context.beginPath();
  context.moveTo(miniTailRoot.x, miniTailRoot.y);
  context.quadraticCurveTo(miniTailRoot.x - 13 * morphology.tailLength, miniTailRoot.y + pose.tailAngle * 5, miniTailRoot.x - 22 * morphology.tailLength, miniTailRoot.y + 7 + pose.tailAngle * 7);
  context.stroke();

  drawMiniLeg("rear-right", false);
  drawMiniLeg("front-right", false);
  const miniHeadAnchor = bodyPoint(42 * morphology.headForward, -18 * morphology.headRise);
  const headX = miniHeadAnchor.x;
  const headY = miniHeadAnchor.y - pose.headLift * 2;
  if (morphology.neckLength > 0.25) {
    const miniNeckStart = bodyPoint(bodyWidth * 0.38, -bodyHeight * 0.2);
    context.strokeStyle = ink;
    context.lineWidth = morphology.family === "giraffe" ? 5 : 3.5;
    context.beginPath();
    context.moveTo(miniNeckStart.x, miniNeckStart.y);
    context.quadraticCurveTo(headX - 9 * morphology.neckLength, bodyY - 9 * morphology.headRise, headX - 2, headY + 5);
    context.stroke();
    if (morphology.family === "giraffe") {
      context.fillStyle = ink;
      for (const amount of [0.28, 0.5, 0.72]) {
        context.beginPath();
        context.arc(
          lerp(miniNeckStart.x, headX - 2, amount) - 2,
          lerp(miniNeckStart.y, headY + 5, amount),
          1.35,
          0,
          Math.PI * 2,
        );
        context.fill();
      }
    }
  }
  context.fillStyle = "rgba(64, 47, 34, 0.1)";
  context.strokeStyle = ink;
  context.lineWidth = 2;
  context.beginPath();
  context.ellipse(headX, headY, 15 * morphology.headScale, 18 * morphology.headScale, -0.28, 0, Math.PI * 2);
  context.fill();
  context.stroke();
  const miniHead = 18 * morphology.headScale;
  if (morphology.family === "elephant") {
    context.lineWidth = 4;
    context.lineCap = "round";
    context.beginPath();
    context.moveTo(headX + miniHead * 0.45, headY + miniHead * 0.25);
    context.quadraticCurveTo(headX + miniHead * 1.2, headY + miniHead, headX + miniHead * 0.9, headY + miniHead * 1.65);
    context.stroke();
  } else if (morphology.family === "equid") {
    context.beginPath();
    context.ellipse(headX + miniHead * 0.55, headY + miniHead * 0.25, miniHead * 0.62, miniHead * 0.36, -0.12, 0, Math.PI * 2);
    context.stroke();
    if (state.animalId === "unicorn") {
      context.beginPath();
      context.moveTo(headX - miniHead * 0.12, headY - miniHead * 0.72);
      context.lineTo(headX + miniHead * 0.48, headY - miniHead * 1.9);
      context.stroke();
    }
  } else if (["bovid", "goat"].includes(morphology.family)) {
    context.beginPath();
    context.moveTo(headX - miniHead * 0.25, headY - miniHead * 0.68);
    context.quadraticCurveTo(headX - miniHead * 0.78, headY - miniHead * 1.45, headX - miniHead * 0.44, headY - miniHead * 1.95);
    context.moveTo(headX + miniHead * 0.12, headY - miniHead * 0.7);
    context.quadraticCurveTo(headX + miniHead * 0.72, headY - miniHead * 1.4, headX + miniHead * 0.42, headY - miniHead * 1.92);
    context.stroke();
  } else if (["feline", "canid", "rabbit"].includes(morphology.family)) {
    context.fillStyle = ink;
    const earHeight = morphology.family === "rabbit" ? miniHead * 1.65 : miniHead * 0.8;
    context.beginPath();
    context.moveTo(headX - miniHead * 0.35, headY - miniHead * 0.48);
    context.lineTo(headX - miniHead * 0.28, headY - miniHead * 0.48 - earHeight);
    context.lineTo(headX, headY - miniHead * 0.55);
    context.moveTo(headX + miniHead * 0.1, headY - miniHead * 0.55);
    context.lineTo(headX + miniHead * 0.38, headY - miniHead * 0.48 - earHeight);
    context.lineTo(headX + miniHead * 0.48, headY - miniHead * 0.36);
    context.fill();
  } else if (morphology.family === "giraffe") {
    context.beginPath();
    context.moveTo(headX - miniHead * 0.18, headY - miniHead * 0.65);
    context.lineTo(headX - miniHead * 0.22, headY - miniHead * 1.05);
    context.moveTo(headX + miniHead * 0.2, headY - miniHead * 0.65);
    context.lineTo(headX + miniHead * 0.34, headY - miniHead * 1.02);
    context.stroke();
  } else if (morphology.family === "lizard") {
    context.beginPath();
    context.moveTo(headX + miniHead * 0.25, headY);
    context.lineTo(headX + miniHead * 1.55, headY + miniHead * 0.12);
    context.stroke();
  } else if (morphology.family === "camel") {
    context.beginPath();
    context.ellipse(headX + miniHead * 0.65, headY + miniHead * 0.24, miniHead * 0.7, miniHead * 0.32, -0.05, 0, Math.PI * 2);
    context.stroke();
  }
  context.fillStyle = ink;
  context.beginPath();
  context.arc(headX + miniHead * 0.18, headY - miniHead * 0.18, 1.2, 0, Math.PI * 2);
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
  motionRow.setAttribute("aria-rowindex", "1");
  const motionLabel = document.createElement("span");
  motionLabel.className = "quadruped-grid-row-label";
  motionLabel.setAttribute("role", "rowheader");
  motionLabel.setAttribute("aria-colindex", "1");
  motionLabel.style.setProperty("--lane-color", "#d7b36a");
  const motionMarker = document.createElement("i");
  motionMarker.setAttribute("aria-hidden", "true");
  motionLabel.append(motionMarker, document.createTextNode("MOTION · cards"));
  motionRow.append(motionLabel);
  for (let step = 0; step < QUADRUPED_STEP_COUNT; step += 1) {
    const cell = document.createElement("span");
    cell.setAttribute("role", "columnheader");
    cell.setAttribute("aria-colindex", String(step + 2));
    const button = createGridButton(-1, step, `Motion-study frame ${step + 1}`);
    button.className = "quadruped-cabinet-frame";
    button.dataset.quarter = String(step % 4 === 0);
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
    rowElement.setAttribute("aria-rowindex", String(row + 2));
    const rowLabel = document.createElement("span");
    rowLabel.className = "quadruped-grid-row-label";
    rowLabel.setAttribute("role", "rowheader");
    rowLabel.setAttribute("aria-colindex", "1");
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
      cell.setAttribute("aria-colindex", String(step + 2));
      const button = createGridButton(row, step, `${lane.label}, step ${step + 1}`);
      button.className = "quadruped-grid-cell";
      button.style.setProperty("--lane-color", lane.color);
      button.dataset.laneId = lane.id;
      button.dataset.quarter = String(step % 4 === 0);
      button.addEventListener("click", (event) => editContact(lane.id, step, event.shiftKey ? -1 : 1));
      cell.append(button);
      rowElement.append(cell);
      gridControls.push({ button, row, step, laneId: lane.id });
    }
    fragment.append(rowElement);
  });

  $("sequenceGrid").replaceChildren(fragment);
  $("sequenceGrid").setAttribute("aria-rowcount", String(QUADRUPED_LANES.length + 1));
  $("sequenceGrid").setAttribute("aria-colcount", String(QUADRUPED_STEP_COUNT + 1));
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
    announce(`${QUADRUPED_LANES[row].label}, step ${step + 1}: no new touchdown.`);
    return;
  } else {
    return;
  }
  event.preventDefault();
  nextRow = clamp(nextRow, -1, QUADRUPED_LANES.length - 1);
  nextStep = mod(nextStep, QUADRUPED_STEP_COUNT);
  for (const control of gridControls) control.button.tabIndex = -1;
  const target = gridControls.find((control) => control.row === nextRow && control.step === nextStep);
  target?.button.focus();
  if (target) target.button.tabIndex = 0;
}

function contactLevelName(value) {
  if (value <= 0) return "no new touchdown";
  return value < 0.8 ? "soft touchdown" : "strong touchdown";
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
      const pose = deriveQuadrupedPose(state, control.step + 0.0001);
      control.button.setAttribute("aria-label", `Motion-study frame ${control.step + 1}, ${pose.airborne ? "airborne" : `${pose.groundSupportCount} feet supporting`}.`);
      continue;
    }
    const value = state.pattern[control.laneId][control.step];
    const support = quadrupedFootCycleState(state, control.laneId, control.step + 0.0001);
    const level = value <= 0 ? "none" : value < 0.8 ? "soft" : "strong";
    const levelName = contactLevelName(value);
    const lane = laneById.get(control.laneId);
    control.button.style.setProperty("--level", String(value));
    control.button.style.setProperty("--support", String(support.grounded ? Math.max(0.12, support.contact) : 0));
    control.button.dataset.level = level;
    control.button.dataset.support = String(support.grounded);
    control.button.textContent = value <= 0 ? "·" : value < 0.8 ? "○" : "●";
    control.button.setAttribute("aria-pressed", value <= 0 ? "false" : value < 0.8 ? "mixed" : "true");
    const supportText = support.grounded
      ? value > 0 ? "touchdown begins support" : "continuing support from an earlier touchdown"
      : "swing";
    control.button.setAttribute("aria-label", `${lane.label}, frame ${control.step + 1}: ${levelName}; ${supportText}. Activate to cycle touchdown strength; Shift activate for previous.`);
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
  $("terrain").value = state.surfaceId;
  $("groundProfile").value = state.groundProfileId;
  $("groundResonance").value = String(state.groundResonance);
  $("level").value = String(state.outputLevel);
  setOutput($("tempoOut"), `${Math.round(state.tempoBpm)} BPM · global`);
  setOutput($("strideOut"), `${Math.round((state.stride - QUADRUPED_LIMITS.stride[0]) / (QUADRUPED_LIMITS.stride[1] - QUADRUPED_LIMITS.stride[0]) * 100)}%`);
  setOutput($("momentumOut"), `${Math.round(state.momentum * 100)}%`);
  setOutput($("gravityOut"), `${Math.round(state.gravity * 100)}%`);
  setOutput($("groundResonanceOut"), `${Math.round(state.groundResonance * 100)}%`);
  setOutput($("levelOut"), `${Math.round(state.outputLevel * 100)}%`);
  setOutput($("animalDescription"), animal.description);
  syncBehaviorReadouts();
  setOutput($("motionSummary"), `${Math.round(state.tempoBpm)} BPM · ${quadrupedTerrain(state.surfaceId).shortLabel} · ${quadrupedGroundProfile(state.groundProfileId).shortLabel}`);
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
  setOutput($("groundProfileReadout"), quadrupedGroundProfile(state.groundProfileId).label);
  setOutput($("stageCode"), `${animal.label.toUpperCase()} / ${behavior.label.toUpperCase()} / ${event.terrain.shortLabel} / ${quadrupedGroundProfile(state.groundProfileId).shortLabel}`);
}

function flashPad(button) {
  button.dataset.flash = "true";
  const timer = globalThis.setTimeout(() => {
    uiTimers.delete(timer);
    button.dataset.flash = "false";
  }, 130);
  uiTimers.add(timer);
}

function programSelectedFoot(laneId, button = null, direction = 1) {
  const lane = laneById.get(laneId);
  if (!lane) return;
  if (button) flashPad(button);
  editContact(laneId, selectedStep, direction);
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

function headPerformanceSignals(pose) {
  const automatic = transportPlaying ? pose.headPerformance ?? {} : {};
  return {
    ...automatic,
    strength: clamp(automatic.strength),
    trunkRaise: clamp(automatic.trunkRaise),
    hornPulse: clamp(automatic.hornPulse),
    headToss: clamp(automatic.headToss),
    earFlick: clamp(automatic.earFlick),
    whiskerPulse: clamp(automatic.whiskerPulse),
    spineFlex: clamp(automatic.spineFlex ?? 0, -1, 1),
    neckSway: clamp(automatic.neckSway ?? 0, -1, 1),
    tongueFlick: clamp(automatic.tongueFlick),
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

function drawLeg(context, id, hipX, hipY, centerX, groundY, bodyScale, pose, color, far) {
  const leg = pose.legs[id];
  const morphology = quadrupedAnimal(state.animalId).morphology;
  const lift = leg.lift;
  const impact = leg.impact;
  const isFront = id.startsWith("front");
  const groundHoofX = centerX + leg.footX * bodyScale * 0.74;
  const contactGroundY = groundY - (leg.footWorldY - pose.bodyGroundHeight) * bodyScale * 0.74;
  const groundHoofY = contactGroundY - lift * bodyScale * 0.46;
  const farSpread = id.endsWith("left") ? -0.07 : 0.07;
  const hoofX = lerp(groundHoofX, hipX + bodyScale * ((isFront ? -0.16 : 0.18) + farSpread), pose.rollTuck);
  const hoofY = lerp(groundHoofY, hipY + bodyScale * (0.24 + farSpread), pose.rollTuck);
  const isHind = !isFront;
  const isDigitigrade = ["feline", "canid", "rabbit"].includes(morphology.family);
  const upperLength = bodyScale * (isFront ? morphology.frontUpper : morphology.hindUpper);
  const lowerLength = bodyScale * (isFront ? morphology.frontLower : morphology.hindLower);
  const distalLength = bodyScale * morphology.distal;
  const bend = (morphology.family === "lizard"
    ? (id.endsWith("left") ? -1 : 1)
    : isHind ? morphology.hindBend : morphology.foreBend);
  const chain = solveQuadrupedLimbChain(
    hipX,
    hipY,
    hoofX,
    hoofY,
    upperLength,
    lowerLength,
    distalLength,
    bend,
    isFront ? -0.025 : isDigitigrade ? 0.09 : 0.035,
    -1,
  );
  context.save();
  context.globalAlpha = far ? 0.56 : 1;
  context.strokeStyle = color;
  context.lineWidth = Math.max(2.5, bodyScale * morphology.legWidth);
  context.lineCap = "round";
  context.lineJoin = "round";
  context.beginPath();
  context.moveTo(hipX, hipY);
  context.lineTo(chain.kneeX, chain.kneeY);
  context.lineTo(chain.ankleX, chain.ankleY);
  context.lineTo(chain.footX, chain.footY);
  context.stroke();
  context.strokeStyle = laneById.get(id).color;
  context.fillStyle = laneById.get(id).color;
  context.lineWidth = Math.max(2.5, bodyScale * morphology.footWidth * 0.72);
  const footHalf = bodyScale * morphology.footWidth * 0.5;
  if (morphology.family === "goat") {
    context.beginPath();
    context.moveTo(chain.footX - footHalf, chain.footY);
    context.lineTo(chain.footX - footHalf * 0.12, chain.footY - bodyScale * 0.008);
    context.moveTo(chain.footX + footHalf * 0.12, chain.footY - bodyScale * 0.008);
    context.lineTo(chain.footX + footHalf, chain.footY);
    context.stroke();
  } else if (["feline", "canid", "rabbit", "camel"].includes(morphology.family)) {
    context.beginPath();
    context.ellipse(chain.footX, chain.footY, footHalf, Math.max(2, bodyScale * morphology.footWidth * 0.22), -0.05, 0, Math.PI * 2);
    context.fill();
  } else {
    context.beginPath();
    context.moveTo(chain.footX - footHalf, chain.footY);
    context.lineTo(chain.footX + footHalf, chain.footY);
    context.stroke();
  }
  context.restore();
  drawContactRipple(context, chain.footX, contactGroundY, laneById.get(id).color, impact, bodyScale);
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

function drawAnimal(context, pose, width, height, groundY) {
  const animal = quadrupedAnimal(state.animalId);
  const morphology = animal.morphology;
  const performanceState = headPerformanceSignals(pose);
  const centerX = width * 0.5;
  const scale = Math.min(height * 0.27, width * 0.145) * animal.bodyScale;
  const isFeline = morphology.family === "feline";
  const isLizard = morphology.family === "lizard";
  const isGiraffe = morphology.family === "giraffe";
  const bodyY = groundY - scale * (morphology.clearance + pose.bodyLift * 0.38);
  const nominalBodyWidth = scale * morphology.bodyWidth;
  const nominalBodyHeight = scale * morphology.bodyHeight;
  const spineGather = isFeline ? clamp(pose.spineFlex, -0.2, 0.2) : 0;
  const bodyWidth = nominalBodyWidth * (1 - spineGather * 0.8);
  const bodyHeight = nominalBodyHeight * (1 + Math.max(0, spineGather) * 0.9);
  const headSize = scale * morphology.headScale;
  const bodyWave = isLizard ? Math.sin(pose.position / QUADRUPED_STEP_COUNT * Math.PI * 2) * 0.11 : 0;
  const bodyRotation = pose.bodyPitch + pose.bodyRoll * 0.22 - pose.rearBalance * 0.58 + bodyWave
    - pose.forwardRoll * Math.PI * 2;
  const bodyPoint = (localX, localY) => ({
    x: centerX + localX * Math.cos(bodyRotation) - localY * Math.sin(bodyRotation),
    y: bodyY + localX * Math.sin(bodyRotation) + localY * Math.cos(bodyRotation),
  });
  const headAnchor = bodyPoint(scale * morphology.headForward, -scale * morphology.headRise);
  const headX = headAnchor.x;
  const headY = headAnchor.y - pose.headLift * scale * (isLizard ? 0.06 : 0.16)
    + pose.headNod * scale * 0.12 - performanceState.headToss * scale * 0.13;
  const hips = {
    "rear-left": bodyPoint(-bodyWidth * 0.4, bodyHeight * 0.2 * morphology.haunch),
    "rear-right": bodyPoint(-bodyWidth * 0.37, bodyHeight * 0.22 * morphology.haunch),
    "front-left": bodyPoint(bodyWidth * 0.37, bodyHeight * 0.18 * morphology.shoulder),
    "front-right": bodyPoint(bodyWidth * 0.4, bodyHeight * 0.2 * morphology.shoulder),
  };
  drawLeg(context, "rear-left", hips["rear-left"].x, hips["rear-left"].y, centerX, groundY, scale, pose, animal.palette[1], true);
  drawLeg(context, "front-left", hips["front-left"].x, hips["front-left"].y, centerX, groundY, scale, pose, animal.palette[1], true);

  context.save();
  context.translate(centerX, bodyY);
  context.rotate(bodyRotation);
  context.fillStyle = animal.palette[0];
  context.strokeStyle = animal.palette[3];
  context.lineWidth = Math.max(2, scale * 0.027);
  context.shadowColor = "rgba(0, 0, 0, 0.35)";
  context.shadowBlur = scale * 0.16;
  context.beginPath();
  context.moveTo(-bodyWidth * 0.53, bodyHeight * 0.04);
  context.bezierCurveTo(-bodyWidth * 0.5, -bodyHeight * 0.46 * morphology.haunch, -bodyWidth * 0.24, -bodyHeight * 0.58, 0, -bodyHeight * 0.5);
  context.bezierCurveTo(bodyWidth * 0.25, -bodyHeight * 0.54, bodyWidth * 0.48, -bodyHeight * 0.44 * morphology.shoulder, bodyWidth * 0.53, -bodyHeight * 0.02);
  context.bezierCurveTo(bodyWidth * 0.5, bodyHeight * 0.48, bodyWidth * 0.2, bodyHeight * 0.52, 0, bodyHeight * 0.48);
  context.bezierCurveTo(-bodyWidth * 0.25, bodyHeight * 0.52, -bodyWidth * 0.5, bodyHeight * 0.45, -bodyWidth * 0.53, bodyHeight * 0.04);
  context.closePath();
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
  if (state.animalId === "giraffe") {
    context.fillStyle = animal.palette[1];
    context.globalAlpha = 0.82;
    for (const [spotX, spotY, radiusX, radiusY, angle] of [
      [-0.4, -0.18, 0.09, 0.14, -0.18], [-0.28, 0.2, 0.1, 0.12, 0.25],
      [-0.08, -0.22, 0.11, 0.14, -0.1], [0.08, 0.2, 0.08, 0.12, 0.18],
      [0.27, -0.16, 0.1, 0.13, -0.24], [0.39, 0.18, 0.07, 0.1, 0.12],
    ]) {
      context.beginPath();
      context.ellipse(bodyWidth * spotX, bodyHeight * spotY, bodyWidth * radiusX, bodyHeight * radiusY, angle, 0, Math.PI * 2);
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
  if (morphology.family === "rabbit") {
    context.fillStyle = animal.palette[1];
    context.beginPath();
    context.ellipse(-bodyWidth * 0.35, bodyHeight * 0.03, bodyWidth * 0.28, bodyHeight * 0.48, -0.12, 0, Math.PI * 2);
    context.fill();
  }
  if (morphology.family === "camel") {
    context.beginPath();
    context.moveTo(-bodyWidth * 0.43, -bodyHeight * 0.4);
    context.bezierCurveTo(-bodyWidth * 0.38, -bodyHeight * 1.03, -bodyWidth * 0.14, -bodyHeight * 1.03, -bodyWidth * 0.04, -bodyHeight * 0.4);
    context.bezierCurveTo(bodyWidth * 0.06, -bodyHeight * 1, bodyWidth * 0.31, -bodyHeight * 0.98, bodyWidth * 0.42, -bodyHeight * 0.36);
    context.closePath();
    context.fill();
    context.stroke();
  }
  context.restore();

  if (morphology.neckLength > 0.25) {
    const neckStart = bodyPoint(bodyWidth * 0.38, -bodyHeight * 0.22);
    const neckWidth = scale * (isGiraffe ? 0.19 : morphology.family === "camel" ? 0.2 : 0.16);
    const neckControlX = headX - scale * morphology.neckLength * (morphology.family === "camel" ? 0.38 : 0.24);
    const neckControlY = bodyY - scale * morphology.headRise * 0.58;
    const neckEndX = headX - headSize * 0.16;
    const neckEndY = headY + headSize * 0.28;
    context.save();
    context.strokeStyle = animal.palette[3];
    context.lineWidth = neckWidth * 1.28;
    context.lineCap = "round";
    context.beginPath();
    context.moveTo(neckStart.x, neckStart.y);
    context.quadraticCurveTo(neckControlX, neckControlY, neckEndX, neckEndY);
    context.stroke();
    context.strokeStyle = animal.palette[0];
    context.lineWidth = neckWidth;
    context.stroke();
    if (isGiraffe) {
      context.fillStyle = animal.palette[1];
      context.globalAlpha = 0.88;
      for (const amount of [0.18, 0.34, 0.5, 0.66, 0.82]) {
        const inverse = 1 - amount;
        const spotX = inverse * inverse * neckStart.x + 2 * inverse * amount * neckControlX + amount * amount * neckEndX;
        const spotY = inverse * inverse * neckStart.y + 2 * inverse * amount * neckControlY + amount * amount * neckEndY;
        context.beginPath();
        context.ellipse(spotX - neckWidth * 0.1, spotY, neckWidth * 0.18, neckWidth * 0.25, amount, 0, Math.PI * 2);
        context.fill();
      }
    }
    context.restore();
  }

  const tailRoot = bodyPoint(-bodyWidth * 0.52, -bodyHeight * 0.12);
  const tailStartX = tailRoot.x;
  const tailStartY = tailRoot.y;
  const tailAngle = pose.tailAngle;
  context.save();
  context.strokeStyle = state.animalId === "unicorn" ? animal.palette[2] : animal.palette[1];
  context.lineWidth = Math.max(3, scale * (
    morphology.family === "elephant" ? 0.065
      : morphology.family === "equid" ? 0.085
        : 0.04
  ));
  context.lineCap = "round";
  context.beginPath();
  context.moveTo(tailStartX, tailStartY);
  context.bezierCurveTo(
    tailStartX - scale * 0.32,
    tailStartY - Math.sin(tailAngle) * scale * 0.42,
    tailStartX - scale * 0.5,
    tailStartY + Math.cos(tailAngle) * scale * 0.34,
    tailStartX - scale * morphology.tailLength,
    tailStartY + Math.sin(tailAngle) * scale * (isLizard ? 0.28 : 0.48),
  );
  context.stroke();
  context.restore();
  if (morphology.family === "rabbit") {
    context.save();
    context.fillStyle = animal.palette[4];
    context.strokeStyle = animal.palette[3];
    context.lineWidth = Math.max(1.5, scale * 0.018);
    context.beginPath();
    context.arc(tailStartX - scale * 0.08, tailStartY - scale * 0.04, scale * 0.12, 0, Math.PI * 2);
    context.fill();
    context.stroke();
    context.restore();
  }

  drawLeg(context, "rear-right", hips["rear-right"].x, hips["rear-right"].y, centerX, groundY, scale, pose, animal.palette[0], false);
  drawLeg(context, "front-right", hips["front-right"].x, hips["front-right"].y, centerX, groundY, scale, pose, animal.palette[0], false);

  context.save();
  if (pose.forwardRoll > 0) {
    context.translate(headX, headY);
    context.rotate(-pose.forwardRoll * Math.PI * 2);
    context.translate(-headX, -headY);
  }
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
    context.ellipse(
      headX,
      headY,
      headSize * (morphology.family === "equid" ? 0.58 : 0.48),
      headSize * (morphology.family === "equid" ? 0.5 : 0.64),
      morphology.family === "equid" ? -0.18 : -0.36,
      0,
      Math.PI * 2,
    );
    context.fill();
    context.stroke();
    if (!isLizard && morphology.family !== "rabbit") {
      context.fillStyle = animal.palette[1];
      if (morphology.family === "equid") {
        const earHeight = state.animalId === "horse" ? 0.42 : 0.72;
        for (const offset of [-0.18, 0.06]) {
          context.beginPath();
          context.moveTo(headX + headSize * offset, headY - headSize * 0.36);
          context.lineTo(headX + headSize * (offset - 0.04), headY - headSize * (0.36 + earHeight));
          context.lineTo(headX + headSize * (offset + 0.16), headY - headSize * 0.4);
          context.closePath();
          context.fill();
        }
      } else {
        context.beginPath();
        context.moveTo(headX - headSize * 0.2, headY - headSize * 0.46);
        context.lineTo(headX - headSize * 0.36, headY - headSize * 0.88);
        context.lineTo(headX + headSize * 0.02, headY - headSize * 0.58);
        context.closePath();
        context.fill();
      }
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
    } else if (morphology.family === "equid") {
      const muzzleX = headX + headSize * 0.42;
      const muzzleY = headY + headSize * 0.16;
      context.fillStyle = state.animalId === "horse" ? animal.palette[1] : animal.palette[4];
      context.beginPath();
      context.ellipse(muzzleX, muzzleY, headSize * 0.4, headSize * 0.19, -0.12, 0, Math.PI * 2);
      context.fill();
      context.stroke();
      context.fillStyle = animal.palette[3];
      context.beginPath();
      context.ellipse(muzzleX + headSize * 0.22, muzzleY - headSize * 0.04, headSize * 0.05, headSize * 0.035, 0, 0, Math.PI * 2);
      context.fill();
      context.strokeStyle = animal.palette[1];
      context.lineWidth = Math.max(2, headSize * 0.09);
      context.beginPath();
      context.moveTo(headX - headSize * 0.28, headY - headSize * 0.45);
      context.bezierCurveTo(headX - headSize * 0.62, headY - headSize * 0.16, headX - headSize * 0.38, headY + headSize * 0.44, headX - headSize * 0.62, headY + headSize * 0.68);
      context.stroke();
    } else if (morphology.family === "canid") {
      context.fillStyle = animal.palette[4];
      context.beginPath();
      context.ellipse(headX + headSize * 0.43, headY + headSize * 0.12, headSize * 0.48, headSize * 0.25, -0.05, 0, Math.PI * 2);
      context.fill();
      context.stroke();
      context.fillStyle = animal.palette[3];
      context.beginPath();
      context.ellipse(headX + headSize * 0.83, headY + headSize * 0.08, headSize * 0.09, headSize * 0.07, 0, 0, Math.PI * 2);
      context.fill();
      context.beginPath();
      context.moveTo(headX + headSize * 0.08, headY - headSize * 0.48);
      context.lineTo(headX + headSize * 0.38, headY - headSize * 0.92);
      context.lineTo(headX + headSize * 0.4, headY - headSize * 0.35);
      context.closePath();
      context.fill();
    } else if (morphology.family === "goat") {
      context.strokeStyle = animal.palette[3];
      context.lineWidth = Math.max(2, headSize * 0.075);
      for (const side of [-1, 1]) {
        context.beginPath();
        context.moveTo(headX + side * headSize * 0.16, headY - headSize * 0.48);
        context.bezierCurveTo(headX + side * headSize * 0.42, headY - headSize * 0.98, headX + side * headSize * 0.1, headY - headSize * 1.18, headX + side * headSize * 0.46, headY - headSize * 1.36);
        context.stroke();
      }
      context.fillStyle = animal.palette[4];
      context.beginPath();
      context.moveTo(headX + headSize * 0.06, headY + headSize * 0.48);
      context.lineTo(headX + headSize * 0.24, headY + headSize * 0.94);
      context.lineTo(headX - headSize * 0.08, headY + headSize * 0.56);
      context.closePath();
      context.fill();
      context.beginPath();
      context.ellipse(headX + headSize * 0.34, headY + headSize * 0.22, headSize * 0.36, headSize * 0.22, -0.08, 0, Math.PI * 2);
      context.fill();
    } else if (morphology.family === "rabbit") {
      context.fillStyle = animal.palette[0];
      context.strokeStyle = animal.palette[3];
      context.lineWidth = Math.max(1.5, headSize * 0.035);
      for (const side of [-1, 1]) {
        context.beginPath();
        context.ellipse(headX + side * headSize * 0.18, headY - headSize * 1.02, headSize * 0.18, headSize * 0.7, side * 0.08, 0, Math.PI * 2);
        context.fill();
        context.stroke();
      }
      context.fillStyle = animal.palette[4];
      context.beginPath();
      context.ellipse(headX + headSize * 0.36, headY + headSize * 0.22, headSize * 0.33, headSize * 0.25, -0.04, 0, Math.PI * 2);
      context.fill();
      context.fillStyle = animal.palette[2];
      context.beginPath();
      context.arc(headX + headSize * 0.62, headY + headSize * 0.18, headSize * 0.07, 0, Math.PI * 2);
      context.fill();
    } else if (morphology.family === "camel") {
      context.fillStyle = animal.palette[4];
      context.beginPath();
      context.ellipse(headX + headSize * 0.48, headY + headSize * 0.22, headSize * 0.58, headSize * 0.27, -0.04, 0, Math.PI * 2);
      context.fill();
      context.stroke();
      context.fillStyle = animal.palette[3];
      context.beginPath();
      context.ellipse(headX + headSize * 0.92, headY + headSize * 0.17, headSize * 0.07, headSize * 0.045, 0, 0, Math.PI * 2);
      context.fill();
      context.fillStyle = animal.palette[1];
      context.beginPath();
      context.moveTo(headX - headSize * 0.15, headY - headSize * 0.48);
      context.lineTo(headX - headSize * 0.34, headY - headSize * 0.84);
      context.lineTo(headX + headSize * 0.02, headY - headSize * 0.58);
      context.closePath();
      context.fill();
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
  const position = transportPlaying ? motorSnapshot.position : selectedStep + 0.0001;
  const pose = deriveQuadrupedPose(state, position, transportPlaying ? motorSnapshot : null);
  const animal = quadrupedAnimal(state.animalId);
  canvas.dataset.frame = String(pose.step);
  canvas.dataset.framePhase = pose.phase.toFixed(4);
  canvas.dataset.motorVelocity = motorSnapshot.velocity.toFixed(4);
  canvas.dataset.support = String(motorSnapshot.supportCount);
  canvas.dataset.airborne = String(motorSnapshot.airborne);
  canvas.dataset.contactLanes = QUADRUPED_LANES
    .filter(({ id }) => pose.legs[id].grounded)
    .map(({ shortLabel }) => shortLabel)
    .join(",");
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

  // Tall-necked bodies keep their limb scale and gain headroom by lowering the
  // camera-followed support plane, not by shortening their anatomy.
  const groundY = height * (["giraffe", "camel"].includes(state.animalId) ? 0.81 : 0.74);
  const stageAnimalScale = Math.min(height * 0.27, width * 0.145) * animal.bodyScale;
  const groundCenterX = width * 0.5;
  const surface = quadrupedTerrain(state.surfaceId);
  const bodyWorldX = position / QUADRUPED_STEP_COUNT * state.stride;
  const worldScale = stageAnimalScale * 0.74;
  const screenGroundYAtX = (screenX) => {
    const worldX = bodyWorldX + (screenX - groundCenterX) / worldScale;
    const worldY = quadrupedGroundHeightAtWorldX(state.groundProfileId, worldX);
    return groundY - (worldY - pose.bodyGroundHeight) * worldScale;
  };
  const traceGroundTop = () => {
    drawing.beginPath();
    for (let screenX = 0; screenX <= width; screenX += 2) {
      const screenY = screenGroundYAtX(screenX);
      if (screenX === 0) drawing.moveTo(screenX, screenY);
      else drawing.lineTo(screenX, screenY);
    }
  };
  const traceGroundFill = () => {
    drawing.beginPath();
    drawing.moveTo(0, height);
    drawing.lineTo(0, screenGroundYAtX(0));
    for (let screenX = 2; screenX <= width; screenX += 2) drawing.lineTo(screenX, screenGroundYAtX(screenX));
    drawing.lineTo(width, height);
    drawing.closePath();
  };
  drawing.save();
  traceGroundFill();
  drawing.fillStyle = surface.color;
  drawing.globalAlpha = 0.78;
  drawing.fill();
  traceGroundFill();
  drawing.clip();
  drawing.globalAlpha = 0.34 + surface.brightness * 0.24;
  drawing.strokeStyle = surface.id === "metal" ? "#d5ffff" : surface.id === "crystal" ? "#fff4ff" : "rgba(14, 19, 16, 0.9)";
  drawing.fillStyle = "rgba(255, 255, 255, 0.36)";
  const textureSpacing = Math.max(18, stageAnimalScale * 0.24);
  const textureOffset = -mod(bodyWorldX * worldScale, textureSpacing);
  for (let index = -1; index <= Math.ceil(width / textureSpacing) + 1; index += 1) {
    const x = textureOffset + index * textureSpacing;
    const localGroundY = screenGroundYAtX(x);
    if (surface.id === "wood") {
      drawing.beginPath();
      drawing.moveTo(x, localGroundY);
      drawing.lineTo(x + textureSpacing * 0.18, height);
      drawing.stroke();
    } else if (surface.id === "metal" || surface.id === "stone") {
      drawing.strokeRect(x + 2, localGroundY + 8, textureSpacing - 4, Math.max(12, height - localGroundY - 24));
    } else if (surface.id === "crystal") {
      drawing.beginPath();
      drawing.moveTo(x, localGroundY + 18);
      drawing.lineTo(x + textureSpacing * 0.45, localGroundY + 5);
      drawing.lineTo(x + textureSpacing * 0.78, localGroundY + 24);
      drawing.stroke();
    } else if (surface.id === "water") {
      drawing.beginPath();
      drawing.arc(x, localGroundY + 13 + (index % 3) * 7, textureSpacing * 0.3, 0, Math.PI);
      drawing.stroke();
    } else if (surface.id === "snow") {
      drawing.beginPath();
      drawing.arc(x, localGroundY + 10 + (index % 4) * 6, 2 + (index % 3), 0, Math.PI * 2);
      drawing.fill();
    } else {
      drawing.beginPath();
      drawing.ellipse(x, localGroundY + 14 + (index % 3) * 8, 2 + (index % 4), 1.5, 0, 0, Math.PI * 2);
      drawing.fill();
    }
  }
  drawing.restore();
  drawing.save();
  drawing.globalAlpha = 0.72;
  drawing.strokeStyle = surface.id === "snow" ? "#ffffff" : surface.id === "water" ? "#a8edff" : "rgba(4, 13, 11, 0.82)";
  drawing.lineWidth = Math.max(1.5, stageAnimalScale * 0.012);
  traceGroundTop();
  drawing.stroke();
  drawing.restore();
  lastFootprintHits = [];
  const newestOrdinal = Math.floor(position + 0.0001);
  const oldestOrdinal = newestOrdinal - QUADRUPED_STEP_COUNT * 3;
  for (let ordinal = oldestOrdinal; ordinal <= newestOrdinal; ordinal += 1) {
    const event = quadrupedSequenceEvent(state, ordinal);
    for (const contact of event.contacts) {
      const cycle = quadrupedFootCycleState(state, contact.id, ordinal);
      const x = groundCenterX + (cycle.anchorWorldX - bodyWorldX) * worldScale;
      if (x < -24 || x > width + 24) continue;
      const age = Math.max(0, position - ordinal);
      const opacity = clamp(1 - age / (QUADRUPED_STEP_COUNT * 3), 0.05, 0.72);
      const lane = laneById.get(contact.id);
      const footprintY = groundY - ((cycle.anchorWorldY ?? 0) - pose.bodyGroundHeight) * worldScale
        + stageAnimalScale * (contact.id.endsWith("left") ? 0.035 : 0.075);
      drawing.save();
      drawing.translate(x, footprintY);
      drawing.globalAlpha = opacity * (0.45 + contact.intensity * 0.55);
      drawing.fillStyle = lane.color;
      drawing.strokeStyle = "rgba(4, 13, 11, 0.92)";
      drawing.lineWidth = Math.max(1, stageAnimalScale * 0.012);
      drawing.beginPath();
      drawing.ellipse(0, 0, stageAnimalScale * (contact.id.startsWith("front") ? 0.095 : 0.11), stageAnimalScale * 0.036, -0.08, 0, Math.PI * 2);
      drawing.fill();
      drawing.stroke();
      if (age < 0.22) {
        drawing.globalAlpha = 1;
        drawing.fillStyle = "#f4fff9";
        drawing.font = `700 ${Math.max(9, height * 0.02)}px ui-monospace, monospace`;
        drawing.textAlign = "center";
        drawing.fillText(lane.shortLabel, 0, -stageAnimalScale * 0.13);
      }
      drawing.restore();
      lastFootprintHits.push({ x: x - 18, y: footprintY - 18, width: 36, height: 36, step: event.step, laneId: contact.id });
    }
  }
  drawing.save();
  drawing.strokeStyle = "rgba(255, 255, 255, 0.45)";
  drawing.lineWidth = 1;
  drawing.setLineDash([3, 5]);
  drawing.beginPath();
  drawing.moveTo(groundCenterX, groundY - height * 0.045);
  drawing.lineTo(groundCenterX, groundY + height * 0.055);
  drawing.stroke();
  drawing.restore();
  if (pose.skidLean > 0.01) {
    drawing.save();
    drawing.strokeStyle = surface.id === "water" ? "#a8edff" : animal.palette[2];
    drawing.globalAlpha = 0.18 + pose.skidLean * 2.4;
    drawing.lineWidth = Math.max(1, stageAnimalScale * 0.012);
    const skidGroundY = screenGroundYAtX(groundCenterX);
    for (let streak = 0; streak < 7; streak += 1) {
      const startX = groundCenterX - stageAnimalScale * (0.5 + streak * 0.13);
      const streakY = skidGroundY - stageAnimalScale * (0.01 + (streak % 3) * 0.035);
      drawing.beginPath();
      drawing.moveTo(startX, streakY);
      drawing.lineTo(startX - stageAnimalScale * (0.22 + (streak % 2) * 0.12), streakY - stageAnimalScale * 0.025);
      drawing.stroke();
    }
    drawing.restore();
  }
  drawAnimal(drawing, pose, width, height, groundY);

  const step = pose.step;
  syncGridPlayhead(transportPlaying ? step : -1);
  updateStageReadouts(step);
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
  const footprint = lastFootprintHits.find((hit) => (
    point.x >= hit.x && point.x <= hit.x + hit.width
    && point.y >= hit.y && point.y <= hit.y + hit.height
  ));
  if (footprint) {
    setSelectedStep(footprint.step, { announceStep: true });
    return;
  }
  if (point.y >= canvasMetrics.height * 0.68) {
    const animal = quadrupedAnimal(state.animalId);
    const scale = Math.min(canvasMetrics.height * 0.27, canvasMetrics.width * 0.145) * animal.bodyScale;
    const pixelsPerFrame = Math.max(4, scale * 0.74 * state.stride / QUADRUPED_STEP_COUNT);
    const frame = Math.floor(currentPosition()) + Math.round((point.x - canvasMetrics.width * 0.5) / pixelsPerFrame);
    setSelectedStep(frame, { announceStep: true });
  }
}

function handleCanvasKeydown(event) {
  if (event.repeat) return;
  if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
    event.preventDefault();
    setSelectedStep(selectedStep + (event.key === "ArrowLeft" ? -1 : 1), { announceStep: true });
    return;
  }
  if (/^[1-4]$/.test(event.key)) {
    event.preventDefault();
    const lane = QUADRUPED_LANES[Number(event.key) - 1];
    const button = $("padGrid").querySelector(`[data-pad-index="${Number(event.key) - 1}"]`);
    programSelectedFoot(lane.id, button, event.shiftKey ? -1 : 1);
  }
}

function handleGlobalKeydown(event) {
  if (event.defaultPrevented || event.repeat || event.ctrlKey || event.altKey || event.metaKey) return;
  const target = event.target;
  if (target?.closest?.("input, select, textarea, button, a, summary, [contenteditable='true'], [role='slider'], [role='grid']")) return;
  if (!/^[1-4]$/.test(event.key)) return;
  event.preventDefault();
  const lane = QUADRUPED_LANES[Number(event.key) - 1];
  const button = $("padGrid").querySelector(`[data-pad-index="${Number(event.key) - 1}"]`);
  programSelectedFoot(lane.id, button, event.shiftKey ? -1 : 1);
}

function bindControls() {
  $("audioButton").addEventListener("click", toggleAudio);
  $("playButton").addEventListener("click", toggleTransport);
  $("restartButton").addEventListener("click", restartTransport);
  $("tempo").addEventListener("input", () => updateStateValue("tempoBpm", $("tempo").value));
  $("stride").addEventListener("input", () => updateStateValue("stride", $("stride").value));
  $("momentum").addEventListener("input", () => updateStateValue("momentum", $("momentum").value));
  $("gravity").addEventListener("input", () => updateStateValue("gravity", $("gravity").value));
  $("terrain").addEventListener("change", () => setSurface($("terrain").value));
  $("groundProfile").addEventListener("change", () => setGroundProfile($("groundProfile").value));
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
    announce("Touchdown accents varied; gait order and the selected surface stayed fixed.");
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
    const next = { ...createQuadrupedState(state.animalId, state.behaviorId), tempoBpm: state.tempoBpm };
    modeMemory.delete(modeKey());
    replaceState(next, { announceMessage: `${quadrupedAnimal(state.animalId).label} ${quadrupedBehavior(state.behaviorId).label} reset to its reproducible starting score.` });
  });
  document.querySelectorAll("[data-animal-id]").forEach((button) => {
    button.addEventListener("click", () => switchAnimal(button.dataset.animalId));
  });
  $("padGrid").querySelectorAll("[data-lane-id]").forEach((button) => {
    button.addEventListener("click", (event) => programSelectedFoot(button.dataset.laneId, button, event.shiftKey ? -1 : 1));
  });
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
    silenceFlightVoice();
    stopAudioScheduler();
    return;
  }
  motorPerformance = performance.now();
  if (graph && transportPlaying) resetAudioSchedule();
  drawScene(performance.now());
});
globalThis.addEventListener("pagehide", teardown, { once: true });

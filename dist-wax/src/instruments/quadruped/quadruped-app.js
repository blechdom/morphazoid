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
  quadrupedBodySlide,
  quadrupedBehaviorFit,
  quadrupedBehaviorsForAnimal,
  quadrupedFootCycleState,
  quadrupedGroundHeightAtWorldX,
  quadrupedGroundProfile,
  quadrupedSequenceEvent,
  quadrupedTerrain,
  quadrupedScoreTiming,
  quadrupedClockAtPosition,
  quadrupedPositionAtClock,
  sanitizeQuadrupedState,
  setQuadrupedContact,
  setQuadrupedGroundProfile,
  setQuadrupedSurface,
  solveQuadrupedLimbChain,
} from "./quadruped.js";
import {
  advanceQuadrupedMotor,
  createQuadrupedMotorState,
  kickQuadrupedMotor,
  predictQuadrupedMotor,
  quadrupedMotorSnapshot,
  synchronizeQuadrupedMotorTempo,
} from "./quadruped-motor.js";
import { QUADRUPED_SOUND_SKINS, createQuadrupedSoundBank, mixQuadrupedContacts } from "./quadruped-sound-skins.js";
import { QUADRUPED_VISUAL_SKINS, drawQuadrupedVisualSkin, drawQuadrupedFootprint } from "./quadruped-visual-skins.js";
import { drawQuadrupedEnvironment } from "./quadruped-environment.js";
import { createQuadrupedOutput } from "./quadruped-output.js";
import { connectAudioOutput } from "../../audio-output-manager.js";
import { quadrupedCalls, quadrupedCallEvents, emptyQuadrupedCalls } from "./quadruped-voices.js";
import { unlockAudioContext } from "../../audio.js";
import { createQuadrupedGroup, shareQuadrupedWorld, quadrupedGroupOffsets, quadrupedStairSound, sanitizeQuadrupedWorld } from "./quadruped-world.js";

import { enhanceRangeKnob } from "../../ui/primitives/range-knob.js";
import { registerHeaderPresets } from "../../site/header-presets.js";
import { QUADRUPED_FULL_PRESETS, captureQuadrupedPreset, normalizeQuadrupedPreset, randomizeQuadrupedPreset } from "./quadruped-presets.js";

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
let presetController = null;
let suspensionKnob = null;
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
let pendingContactSounds = null;
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
let groupMode = "solo";
let selectedActor = 0;
let groupSeed = 1;
let soundSkinId = "ground";
let visualSkinId = "animal";
let world = sanitizeQuadrupedWorld();
let courseOriginX = 0;
const actors = [{ score: state, motor, nextOrdinal: null, transitions: new Map(), offset: 0 }];

function capturePreset() {
  saveSelectedActor();
  return captureQuadrupedPreset({ actors, groupMode, selectedActor, groupSeed, world, soundSkinId, visualSkinId });
}

function applyPreset(snapshot) {
  const next = normalizeQuadrupedPreset(snapshot);
  const now = performance.now();
  materializeMotor(now);
  saveSelectedActor();
  const outputLevel = state.outputLevel;
  const clock = quadrupedClockAtPosition(state, motor.position)
    - (groupMode === "solo" ? 0 : actors[selectedActor].offset * 16);
  const offsets = quadrupedGroupOffsets(next.groupSeed);
  const nextActors = next.actors.map((score, index) => {
    const nextScore = sanitizeQuadrupedState({ ...score, outputLevel });
    const offset = next.groupMode === "solo" ? 0 : offsets[index];
    const position = quadrupedPositionAtClock(nextScore, Math.max(0, clock + offset * 16));
    return { score: nextScore, motor: createQuadrupedMotorState(nextScore, { position }),
      nextOrdinal: null, transitions: new Map(), offset };
  });
  actors.splice(0, actors.length, ...nextActors);
  groupMode = next.groupMode;
  groupSeed = next.groupSeed;
  selectedActor = next.selectedActor;
  world = next.world;
  soundSkinId = next.soundSkinId;
  visualSkinId = next.visualSkinId;
  state = actors[selectedActor].score;
  motor = actors[selectedActor].motor;
  motorPerformance = now;
  stoppedPosition = motor.position;
  selectedStep = mod(Math.floor(motor.position), QUADRUPED_STEP_COUNT);
  lastPlayingStep = -1;
  lastReadoutStep = -1;
  modeMemory.clear();
  syncAllControls();
  resetAudioSchedule();
}

function activeActorIndices() {
  return groupMode === "solo" ? [selectedActor] : actors.map((_, index) => index);
}

function saveSelectedActor() {
  actors[selectedActor].score = state;
  actors[selectedActor].motor = motor;
}

function shareGroupControls() {
  saveSelectedActor();
  for (let index = 0; index < actors.length; index += 1) {
    if (index === selectedActor) continue;
    const actor = actors[index];
    actor.score = shareQuadrupedWorld(actor.score, state);
    if (groupMode === "herd" && actor.score.animalId !== state.animalId) actor.score = applyQuadrupedAnimal(actor.score, state.animalId);
    actor.motor = synchronizeQuadrupedMotorTempo(actor.score, actor.motor);
  }
}

function worldSoundAt(score = state, position = motor.position, laneId = null) {
  if (score.groundProfileId === "level") return quadrupedStairSound(score, 0, world.cavern, courseOriginX);
  const worldX = laneId ? quadrupedFootCycleState(score, laneId, position + 0.00001).footWorldX : position / 16 * score.stride;
  return quadrupedStairSound(score, worldX, world.cavern, courseOriginX);
}

function selectActor(index) {
  const nextIndex = Math.trunc(clamp(index, 0, actors.length - 1));
  if (nextIndex === selectedActor) return;
  materializeMotor();
  saveSelectedActor();
  selectedActor = nextIndex;
  state = actors[nextIndex].score;
  motor = actors[nextIndex].motor;
  stoppedPosition = motor.position;
  selectedStep = mod(Math.floor(motor.position), 16);
  lastPlayingStep = -1;
  lastReadoutStep = -1;
  syncAllControls();
  announce(`Editing animal ${"ABC"[nextIndex]}: ${quadrupedAnimal(state.animalId).label}. Other rhythms keep moving.`);
}

function setGroupMode(mode) {
  if (!["solo", "herd", "trio"].includes(mode) || mode === groupMode) return;
  materializeMotor();
  saveSelectedActor();
  const leader = state;
  const clock = quadrupedClockAtPosition(state, motor.position);
  const scores = createQuadrupedGroup(leader, mode);
  const offsets = quadrupedGroupOffsets(groupSeed);
  if (mode !== "solo") {
    modeMemory.clear();
    actors.splice(0, actors.length, ...scores.map((score, index) => {
      const position = quadrupedPositionAtClock(score, clock + offsets[index] * 16);
      return { score, motor: createQuadrupedMotorState(score, { position }), nextOrdinal: null, transitions: new Map(), offset: offsets[index] };
    }));
    selectedActor = 0;
    state = actors[0].score;
    motor = actors[0].motor;
  }
  groupMode = mode;
  stoppedPosition = motor.position;
  syncAllControls();
  resetAudioSchedule();
}

function scatterGroup() {
  materializeMotor();
  saveSelectedActor();
  groupSeed += 97;
  const offsets = quadrupedGroupOffsets(groupSeed);
  const clock = quadrupedClockAtPosition(actors[0].score, actors[0].motor.position) - actors[0].offset * 16;
  actors.forEach((actor, index) => {
    actor.offset = offsets[index];
    actor.motor = createQuadrupedMotorState(actor.score, { ...actor.motor, position: quadrupedPositionAtClock(actor.score, clock + offsets[index] * 16) });
  });
  motor = actors[selectedActor].motor;
  stoppedPosition = motor.position;
  resetAudioSchedule();
  syncAllControls();
}

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
  return `${selectedActor}:${source.animalId}:${source.behaviorId}`;
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
  for (const index of activeActorIndices()) {
    if (index === selectedActor || deltaSeconds <= 0) continue;
    const actor = actors[index];
    actor.motor = advanceQuadrupedMotor(actor.score, actor.motor, deltaSeconds).motor;
  }
  motorPerformance = safeNow;
  stoppedPosition = motor.position;
  saveSelectedActor();
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
  materialBus.surfaceId = terrain.id;
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
  const voice = { source, highpass, bandpass, gain, panner, active: false };
  source.onended = () => {
    for (const node of [source, highpass, bandpass, gain, panner]) node.disconnect();
  };
  return voice;
}

function silenceContinuousVoice(voice, releaseSeconds = 0.025) {
  if (!voice || !graph) return;
  const now = graph.context.currentTime;
  voice.gain.gain.cancelScheduledValues(now);
  voice.gain.gain.setValueAtTime(voice.gain.gain.value, now);
  voice.gain.gain.linearRampToValueAtTime(0, now + Math.max(0.006, releaseSeconds));
  voice.active = false;
}

function silenceFlightVoice(releaseSeconds = 0.025) {
  for (const voice of graph?.flightVoices ?? []) silenceContinuousVoice(voice, releaseSeconds);
}

function createCavernBus(context, mixBus) {
  const input = context.createGain();
  const tone = context.createBiquadFilter();
  const wet = context.createGain();
  tone.type = "lowpass";
  tone.frequency.value = 12_000;
  wet.gain.value = 0;
  input.connect(tone);
  tone.connect(mixBus);
  input.connect(wet);
  const echoes = [0.127, 0.193, 0.281].map((seconds, index) => {
    const delay = context.createDelay(1);
    const damping = context.createBiquadFilter();
    const feedback = context.createGain();
    const level = context.createGain();
    const pan = createPanner(context, (index - 1) * 0.62);
    delay.delayTime.value = seconds;
    damping.type = "lowpass"; damping.frequency.value = 5_000;
    feedback.gain.value = 0.18; level.gain.value = 0.26;
    wet.connect(delay); delay.connect(damping); damping.connect(feedback);
    feedback.connect(delay); damping.connect(level); level.connect(pan); pan.connect(mixBus);
    return { delay, damping, feedback, level, pan, ratio: seconds / 0.127 };
  });
  return { input, tone, wet, echoes };
}

function syncCavernBus() {
  if (!graph) return;
  const leader = actors[activeActorIndices()[0]];
  const color = worldSoundAt(leader.score, leader.motor.position);
  const now = graph.context.currentTime;
  const bus = graph.cavernBus;
  bus.tone.frequency.setTargetAtTime(color.cutoff, now, 0.045);
  bus.wet.gain.setTargetAtTime(transportPlaying ? color.wet : 0, now, 0.035);
  for (const echo of bus.echoes) {
    echo.delay.delayTime.setTargetAtTime(color.delay * echo.ratio, now, 0.13);
    echo.damping.frequency.setTargetAtTime(color.damping, now, 0.06);
    echo.feedback.gain.setTargetAtTime(color.feedback, now, 0.06);
  }
}

function syncFlightVoice(snapshot, score = state, index = selectedActor) {
  const voice = graph?.flightVoices[index];
  if (!voice || !graph || !transportPlaying) {
    silenceContinuousVoice(voice);
    return;
  }
  const sliding = snapshot.bodySlide > 0;
  const extendedRest = quadrupedScoreTiming(score).window !== null;
  const unsupported = snapshot.supportCount === 0 && !extendedRest && !sliding;
  const now = graph.context.currentTime;
  const speed = clamp(snapshot.normalizedVelocity / 1.25);
  const vertical = clamp(Math.abs(snapshot.verticalVelocity) / 6);
  const height = clamp(snapshot.height / 1.2);
  const energy = clamp(0.68 * speed + 0.2 * vertical + 0.12 * height);
  const ensembleGain = groupMode === "solo" ? 1 : 0.52;
  const pan = groupMode === "solo" ? 0 : (index - 1) * 0.6;
  voice.active = unsupported;
  voice.gain.gain.setTargetAtTime(unsupported ? 0.075 * energy ** 1.25 * ensembleGain : 0, now, 0.018);
  voice.highpass.frequency.setTargetAtTime(80 + 420 * speed, now, 0.025);
  voice.bandpass.frequency.setTargetAtTime(450 + 2_800 * speed + 850 * vertical, now, 0.025);
  voice.bandpass.Q.setTargetAtTime(0.55 + 0.8 * height, now, 0.025);
  voice.panner.pan?.setTargetAtTime(pan, now, 0.03);

}

async function createAudioGraph() {
  const Context = globalThis.AudioContext ?? globalThis.webkitAudioContext;
  if (!Context) throw new Error("This browser does not provide Web Audio.");
  const context = new Context({ latencyHint: "interactive", sampleRate: 48_000 });
  unlockAudioContext(context);
  await context.resume();
  const mixBus = context.createGain();
  const compressor = context.createDynamicsCompressor();
  const outputStage = createQuadrupedOutput(context, { outputLevel: state.outputLevel });
  const { masterGain } = outputStage;
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
  compressor.connect(outputStage.input);
  outputStage.output.connect(analyser);
  const releaseOutput = connectAudioOutput(context, analyser, { runtime: globalThis });
  const noiseBuffer = createNoiseBuffer(context);
  const cavernBus = createCavernBus(context, mixBus);
  const materialBus = createMaterialBus(context, cavernBus.input);
  applyMaterialProfile(materialBus, quadrupedTerrain(state.surfaceId), context.currentTime, true);
  const flightVoices = Array.from({ length: 3 }, () => createFlightVoice(context, cavernBus.input, noiseBuffer));
  const flightVoice = flightVoices[0];
  return {
    context,
    mixBus,
    compressor,
    masterGain,
    outputStage,
    analyser,
    releaseOutput,
    noiseBuffer,
    materialBus,
    flightVoice,
    flightVoices,
    soundBank: createQuadrupedSoundBank({ sampleRate: 24_000, maxEntries: 256 }),
    contactBuffers: new WeakMap(),
    contactResamples: new WeakMap(),
    cavernBus,
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
    if (evictAudioSource((record) => record.role === "body-accent")) continue;
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
    if (record.role === "body-contact-batch" || record.startTime > boundary) cancelAudioSource(record, 0.004);
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
    for (const voice of closing.flightVoices) {
      voice.source.stop();
      for (const node of [voice.source, voice.highpass, voice.bandpass, voice.gain, voice.panner]) node.disconnect();
    }
    for (const node of [closing.cavernBus.input, closing.cavernBus.tone, closing.cavernBus.wet, ...closing.cavernBus.echoes.flatMap(echo => [echo.delay, echo.damping, echo.feedback, echo.level, echo.pan])]) node.disconnect();
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
    closing.outputStage.disconnect();
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
  pulse = 0,
  role = "head-core",
}) {
  if (!graph || !Number.isFinite(when)) return null;
  const safeNotes = (Array.isArray(notes) ? notes : [])
    .map((note) => Number(note) + octaveOffset)
    .filter(Number.isFinite)
    .slice(0, 6);
  if (!safeNotes.length) return null;
  const { context, mixBus } = graph;
  const safeDuration = clamp(duration, 0.08, 1.8);
  const start = Math.max(context.currentTime + 0.004, when);
  const end = start + safeDuration;
  const oscillator = context.createOscillator();
  const pulseGain = context.createGain();
  if (pulse > 0) {
    const curve = Float32Array.from({ length: 256 }, (_, index) => 0.58 + 0.42 * Math.sin(index / 255 * safeDuration * pulse * Math.PI * 2));
    pulseGain.gain.setValueCurveAtTime(curve, start, safeDuration);
  }
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
  gain.connect(pulseGain);
  pulseGain.connect(filter);
  filter.connect(panner);
  panner.connect(mixBus);
  registerAudioSource(oscillator, [gain, pulseGain, filter, panner], gain, start, end, role);
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

function footSoundPlacement(score, position, laneId, actorIndex) {
  const color = worldSoundAt(score, position, laneId);
  return { pitch: color.pitchRatio, gain: groupMode === "solo" ? 1 : 0.52, pan: groupMode === "solo" ? null : (actorIndex - 1) * 0.6 };
}

// Prepared, bounded sample voices follow the same motor events as the limbs.
// Each event varies its excitation; there is no held or looping scrape source.
function scheduleContactSound(phase, contact, terrain, when, normalization, position, score, actorIndex, velocity) {
  if (!graph || !Number.isFinite(when)) return;
  const placement = footSoundPlacement(score, position, contact.id, actorIndex);
  const laneIndex = laneById.get(contact.id)?.index ?? 0;
  const voice = graph.soundBank.get({
    skinId: soundSkinId, phase, animal: quadrupedAnimal(score.animalId), terrain, contact,
    velocity: velocity ?? actors[actorIndex]?.motor.velocity ?? 0,
    resonance: score.groundResonance, scrape: world.grain, pitchRatio: placement.pitch,
    seed: (world.seed + Math.floor(position * 997) + laneIndex * 173 + actorIndex * 53) >>> 0,
  });
  const pan = lanePan[contact.id] ?? 0;
  const placedPan = placement.pan === null ? pan : placement.pan + pan * 0.24;
  const placedGain = voice.gain * normalization * placement.gain;
  if (pendingContactSounds) {
    pendingContactSounds.push({ voice, when, pan: placedPan, gain: placedGain });
    return;
  }
  const { context } = graph;
  let buffer = graph.contactBuffers.get(voice.samples);
  if (!buffer) {
    buffer = context.createBuffer(1, voice.samples.length, voice.sampleRate);
    buffer.copyToChannel(voice.samples, 0);
    graph.contactBuffers.set(voice.samples, buffer);
  }
  const start = Math.max(context.currentTime + 0.004, when);
  const end = start + voice.duration / voice.playbackRate;
  const source = context.createBufferSource();
  const gain = context.createGain();
  const panner = createPanner(context, placedPan);
  source.buffer = buffer;
  source.playbackRate.value = voice.playbackRate;
  gain.gain.value = placedGain;
  source.connect(gain); gain.connect(panner); panner.connect(graph.materialBus.input);
  registerAudioSource(source, [gain, panner], gain, start, end, phase === "touchdown" ? "body-contact" : "body-accent");
  source.start(start); source.stop(end + 0.005);
}

function flushContactSounds(events) {
  if (!graph || !events.length) return;
  const { context } = graph;
  const earliest = Math.min(...events.map(event => event.when));
  const mixed = mixQuadrupedContacts(events.map(event => ({ ...event, offset: event.when - earliest })), 24_000, graph.contactResamples);
  const buffer = context.createBuffer(2, mixed.channels[0].length, mixed.sampleRate);
  mixed.channels.forEach((samples, index) => buffer.copyToChannel(samples, index));
  const source = context.createBufferSource();
  const gain = context.createGain();
  source.buffer = buffer;
  source.connect(gain); gain.connect(graph.materialBus.input);
  const start = Math.max(context.currentTime + 0.002, earliest);
  const end = start + mixed.duration;
  registerAudioSource(source, [gain], gain, start, end, "body-contact-batch");
  source.start(start); source.stop(end + 0.005);
}

function scheduleFoot(contact, terrain, when, normalization, absoluteStep, score = state, actorIndex = selectedActor) {
  scheduleContactSound("touchdown", contact, terrain, when, normalization, absoluteStep, score, actorIndex);
}

function scheduleToeOff(transition, terrain, when, score = state, actorIndex = selectedActor) {
  scheduleContactSound("toe-off", { id: transition.laneId, intensity: transition.intensity }, terrain,
    when, 1, transition.position, score, actorIndex, transition.velocity);
}

function scheduleStanceAccent(transition, terrain, when, score = state, actorIndex = selectedActor) {
  scheduleContactSound(transition.type, { id: transition.laneId, intensity: transition.intensity }, terrain,
    when, 1, transition.position, score, actorIndex, transition.velocity);
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

function scheduleCall(call, when, actorIndex = selectedActor) {
  if (!graph) return;
  const amount = call.intensity * (groupMode === "solo" ? 1 : 0.52);
  const pan = groupMode === "solo" ? 0 : (actorIndex - 1) * 0.6;
  const offsets = call.notes.map((_, index) => index / call.notes.length * call.duration * 0.8);
  if (["Sparkle", "Prism", "Marimba", "Neck harp", "Click song"].includes(call.label)) {
    call.notes.forEach((note, index) => scheduleTone({
      when: when + offsets[index], frequency: midiToFrequency(note), duration: call.duration / 3,
      peak: 0.14 * amount, pan: clamp(pan + (index % 2 ? 0.12 : -0.12), -1, 1),
      type: call.type, attack: 0.003, startRatio: 1.02, endRatio: 0.997,
      filterFrequency: call.filter, filterQ: 0.8, role: "head-core",
    }));
  } else {
    schedulePitchContour({ when, notes: call.notes, offsets, duration: call.duration,
      peak: 0.19 * amount, pan, type: call.type, attack: call.label === "Strings" ? 0.075 : 0.016,
      filterFrequency: call.filter, filterQ: 0.85, pulse: call.pulse });
    schedulePitchContour({ when, notes: call.notes, offsets, duration: call.duration,
      peak: 0.055 * amount, pan, type: "sine", attack: 0.022, octaveOffset: -12,
      filterFrequency: call.filter * 0.6, filterQ: 0.55, pulse: call.pulse });
  }
}

function scheduleStep(absoluteStep, when, motorEvent = null, score = state, actorIndex = selectedActor) {
  for (const call of quadrupedCallEvents(score, absoluteStep)) scheduleCall(call, when, actorIndex);
  const scoreEvent = quadrupedSequenceEvent(score, absoluteStep);
  const contacts = Array.isArray(motorEvent?.contacts) ? motorEvent.contacts : scoreEvent.contacts;
  const terrain = motorEvent?.terrain ?? scoreEvent.terrain;
  if (!contacts.length) return;
  const motionEnergy = clamp(0.58 + (motorEvent?.velocity ?? 0) / 42, 0.48, 1);
  const normalization = motionEnergy / Math.sqrt(Math.max(1, contacts.length));
  for (const contact of contacts) {
    const uphill = score.groundProfileId === "stairs-up";
    const downhill = score.groundProfileId === "stairs-down";
    const fore = contact.id.startsWith("front");
    const stairLoad = uphill ? (fore ? 0.84 : 1.3) : downhill ? (fore ? 1.32 : 0.8) : 1;
    scheduleFoot(contact, terrain, when, normalization * stairLoad, absoluteStep, score, actorIndex);
  }
}

// A skid presses the body against the ground even when all four feet lift.
// Irregular clock-position contacts preserve this sound without a noise loop.
function scheduleBodySlide(actor, actorIndex, snapshot, audioNow) {
  if (actor.score.behaviorId !== "skid" || snapshot.velocity <= 0.012) return;
  const clockRate = actor.score.tempoBpm * 16 / 60;
  const spacing = Math.max(1, clockRate * 0.085);
  const from = snapshot.clockPosition;
  const through = from + clockRate * QUADRUPED_LIMITS.schedulerLookaheadSeconds;
  for (let ordinal = Math.floor(from / spacing); ordinal <= Math.ceil(through / spacing); ordinal += 1) {
    const seed = (Math.imul(ordinal + actorIndex * 17, 1664525) ^ world.seed) >>> 0;
    const variation = ((Math.imul(seed ^ (seed >>> 13), 1274126177) >>> 0) % 1000) / 1000;
    const clock = (ordinal + 0.15 + variation * 0.7) * spacing;
    if (clock < from || clock > through) continue;
    const position = quadrupedPositionAtClock(actor.score, clock);
    const pressure = quadrupedBodySlide(actor.score, position);
    if (pressure <= 0.01) continue;
    const eventId = `slide:${spacing}:${ordinal}`;
    if (actor.transitions.has(eventId)) continue;
    const when = audioNow + Math.max(0.006, (clock - from) / clockRate);
    scheduleContactSound(ordinal % 5 === 0 ? "touchdown" : "push",
      { id: ordinal % 2 ? "rear-left" : "rear-right", intensity: pressure * (0.38 + variation * 0.5) },
      quadrupedTerrain(actor.score.surfaceId), when, 0.85, position, actor.score, actorIndex, snapshot.velocity);
    actor.transitions.set(eventId, when);
  }
}

function scheduleAudioWindow() {
  if (!graph || !transportPlaying || graph.context.state !== "running") return;
  materializeMotor(performance.now());
  syncCavernBus();
  const audioNow = graph.context.currentTime;
  const active = activeActorIndices();
  pendingContactSounds = [];
  for (let index = 0; index < graph.flightVoices.length; index += 1) {
    if (!active.includes(index)) {
      silenceContinuousVoice(graph.flightVoices[index]);
    }
  }
  for (const index of active) {
    const actor = actors[index];
    const snapshot = quadrupedMotorSnapshot(actor.score, actor.motor);
    syncFlightVoice(snapshot, actor.score, index);
    const prediction = predictQuadrupedMotor(actor.score, actor.motor, QUADRUPED_LIMITS.schedulerLookaheadSeconds);
    scheduleBodySlide(actor, index, snapshot, audioNow);
    for (const [eventId, scheduledTime] of actor.transitions) {
      if (scheduledTime < audioNow - 0.1) actor.transitions.delete(eventId);
    }
    for (const transition of prediction.transitions) {
      if (!transition.eventId || actor.transitions.has(transition.eventId)) continue;
      const when = audioNow + Math.max(0.006, transition.offsetSeconds);
      const terrain = quadrupedTerrain(actor.score.surfaceId);
      if (transition.type === "toe-off") scheduleToeOff(transition, terrain, when, actor.score, index);
      else if (transition.type === "load" || transition.type === "push") scheduleStanceAccent(transition, terrain, when, actor.score, index);
      else continue;
      actor.transitions.set(transition.eventId, when);
    }
    if (!Number.isFinite(actor.nextOrdinal) || actor.nextOrdinal < snapshot.position - 0.02) actor.nextOrdinal = Math.floor(snapshot.position + 0.0001) + 1;
    let scheduled = 0;
    for (const crossing of prediction.events) {
      if (crossing.ordinal < actor.nextOrdinal) continue;
      if (scheduled >= 48) break;
      scheduleStep(crossing.ordinal, audioNow + Math.max(0.006, crossing.offsetSeconds), crossing, actor.score, index);
      actor.nextOrdinal = crossing.ordinal + 1;
      scheduled += 1;
    }
  }
  const contacts = pendingContactSounds;
  pendingContactSounds = null;
  flushContactSounds(contacts);
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
  for (const actor of actors) {
    actor.nextOrdinal = null;
    actor.transitions.clear();
  }
}

function resetAudioSchedule({ includeCurrentBoundary = false } = {}) {
  stopAudioScheduler();
  cancelFutureSources();
  saveSelectedActor();
  if (!graph || !transportPlaying) return;
  materializeMotor();
  for (const index of activeActorIndices()) {
    const actor = actors[index];
    const position = actor.motor.position;
    const nearestBoundary = Math.round(position);
    const startsOnBoundary = includeCurrentBoundary && Math.abs(position - nearestBoundary) < 0.05;
    actor.nextOrdinal = startsOnBoundary ? nearestBoundary : Math.ceil(position + 0.015);
    if (startsOnBoundary) {
      const snapshot = quadrupedMotorSnapshot(actor.score, actor.motor);
      scheduleStep(nearestBoundary, graph.context.currentTime + 0.008, snapshot, actor.score, index);
      actor.nextOrdinal = nearestBoundary + 1;
    }
  }
  startAudioScheduler();
}

function syncTransportPresentation() {
  const play = $("playButton");
  play.setAttribute("aria-label", transportPlaying ? "Pause sequence" : "Start sequence");
  play.title = transportPlaying ? "Pause sequence (Space)" : "Start sequence (Space)";
  play.setAttribute("aria-pressed", String(transportPlaying));
  setOutput($("playLabel"), transportPlaying ? "Pause" : stoppedPosition > 0 ? "Resume" : "Start");
  const snapshot = quadrupedMotorSnapshot(state, motor);
  const actualCadence = Math.round(snapshot.velocity / QUADRUPED_STEP_COUNT * 60);
  setOutput($("playState"), transportPlaying
    ? snapshot.stalled
      ? "stalled · add a footfall"
      : `${Math.round(state.tempoBpm)} BPM · ${snapshot.bodySlide > 0 ? "slide" : snapshot.airborne ? "air · rest" : `${state.paceRatio}×`}`
    : `Press Start · step ${mod(Math.floor(stoppedPosition), QUADRUPED_STEP_COUNT) + 1}`);
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
  if (graph) {
    const now = graph.context.currentTime;
    graph.cavernBus.wet.gain.setTargetAtTime(0, now, 0.02);
    for (const echo of graph.cavernBus.echoes) echo.feedback.gain.setTargetAtTime(0, now, 0.025);
  }
  releaseAllSources();
  renderGridState();
  syncTransportPresentation();
  syncGridPlayhead(-1);
  updateStageReadouts(selectedStep, true);
  // Commit the stopped frame immediately, even if the browser delays its next RAF.
  drawScene(performance.now());
  announce("Quadruped sequence paused.");
}

function toggleTransport() {
  if (transportPlaying) stopTransport();
  else startTransport();
}

function restartTransport() {
  courseOriginX = 0;
  retimeTransport(0);
  for (const index of activeActorIndices()) {
    if (index === selectedActor) continue;
    const actor = actors[index];
    actor.motor = createQuadrupedMotorState(actor.score, { position: quadrupedPositionAtClock(actor.score, actor.offset * 16) });
  }
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
  const next = applyQuadrupedAnimal(state, targetAnimal.id);
  replaceState({ ...next, tempoBpm: state.tempoBpm, paceRatio: state.paceRatio, suspensionBeats: state.suspensionBeats, outputLevel: state.outputLevel }, {
    announceMessage: `${targetAnimal.label} loaded. The global tempo and moving playhead stayed put.`,
  });
}

function switchBehavior(behaviorId) {
  if (behaviorId === state.behaviorId) return;
  rememberMode();
  const key = `${selectedActor}:${state.animalId}:${behaviorId}`;
  const stored = modeMemory.get(key);
  const next = stored ?? applyQuadrupedBehavior(state, behaviorId);
  replaceState({ ...next, tempoBpm: state.tempoBpm, paceRatio: state.paceRatio, suspensionBeats: state.suspensionBeats, outputLevel: state.outputLevel }, {
    announceMessage: `${quadrupedBehavior(behaviorId).label} loaded on the same global tempo.`,
  });
}

function updateStateValue(key, value) {
  const now = performance.now();
  const position = currentPosition(now);
  state = sanitizeQuadrupedState({ ...state, [key]: value }, state);
  retimeTransport(position, now, { preserveMotion: true });
  if (["tempoBpm", "paceRatio", "suspensionBeats"].includes(key)) {
    motor = synchronizeQuadrupedMotorTempo(state, motor);
    stoppedPosition = motor.position;
  }
  shareGroupControls();
  if (key === "outputLevel" && graph) {
    graph.masterGain.gain.setTargetAtTime(state.outputLevel, graph.context.currentTime, 0.025);
  } else if (["tempoBpm", "paceRatio", "suspensionBeats", "stride", "momentum", "gravity"].includes(key)) {
    resetAudioSchedule();
  }
  syncAllControls({ grid: ["paceRatio", "suspensionBeats", "stride", "momentum", "gravity"].includes(key) });
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
  shareGroupControls();
  rememberMode();
  resetAudioSchedule();
  syncAllControls({ grid: false });
  updateStageReadouts(selectedStep, true);
  announce(`${quadrupedTerrain(state.surfaceId).label} now covers the whole contact field.`);
}

function setGroundProfile(groundProfileId) {
  const now = performance.now();
  const position = currentPosition(now);
  courseOriginX = position / 16 * state.stride;
  state = setQuadrupedGroundProfile(state, groundProfileId);
  retimeTransport(position, now, { preserveMotion: true });
  shareGroupControls();
  rememberMode();
  resetAudioSchedule();
  syncAllControls({ grid: true });
  const profile = quadrupedGroundProfile(state.groundProfileId);
  announce(`${profile.label}. The current stance relatches to this course; each new touchdown keeps its tread until lift-off.`);
}

function buildBehaviorOptions() {
  const fragment = document.createDocumentFragment();
  const behaviors = quadrupedBehaviorsForAnimal(state.animalId);
  for (const behavior of behaviors) {
    const option = document.createElement("option");
    option.value = behavior.id;
    option.textContent = behavior.label;
    fragment.append(option);
  }
  $("behaviorSelect").replaceChildren(fragment);
  $("behaviorSelect").value = state.behaviorId;
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
    // Focus only moves the roving target and selection. Rewriting button text
    // and repainting 16 cards inside pointer focus can interrupt a native click.
    for (const control of gridControls) {
      control.button.tabIndex = control.button === button ? 0 : -1;
      control.button.dataset.selected = String(control.step === step);
    }
    selectedStep = step;
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
  const bodyY = groundY - lerp(31 * morphology.clearance + pose.bodyLift * 7, 9 * morphology.bodyHeight, pose.bodySlide);
  const bodyWidth = 20 * morphology.bodyWidth;
  const bodyHeight = 18 * morphology.bodyHeight;
  const miniRotation = pose.bodyPitch + pose.bodyRoll * 0.22 - pose.rearBalance * 0.58
    + pose.forwardRoll * Math.PI * 2 + pose.cartwheel * Math.PI * 2;
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
    if (pose.bodySlide > 0.85) return;
    const leg = pose.legs[laneId];
    const hipX = hips[laneId].x;
    const hipY = hips[laneId].y;
    const isFront = laneId.startsWith("front");
    const groundHoofX = 52 + leg.footX * 31;
    const groundHoofY = groundY - (leg.footWorldY - pose.bodyGroundHeight) * 31 - leg.lift * 17;
    const farSpread = laneId.endsWith("left") ? -2.5 : 2.5;
    let hoofX = lerp(groundHoofX, hipX + (isFront ? -5 : 5) + farSpread, pose.rollTuck);
    let hoofY = lerp(groundHoofY, hipY + 7 + farSpread, pose.rollTuck);
    const upper = 31 * (isFront ? morphology.frontUpper : morphology.hindUpper);
    const lower = 31 * (isFront ? morphology.frontLower : morphology.hindLower);
    const distal = 31 * morphology.distal;
    if (pose.cartwheel > 0 && !leg.grounded) {
      const angle = pose.cartwheel * Math.PI * 2 + (isFront ? -0.7 : 0.7) + (far ? -0.28 : 0.28);
      hoofX = hipX - Math.sin(angle) * (upper + lower) * 0.9;
      hoofY = hipY + Math.cos(angle) * (upper + lower) * 0.9;
    }
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
      morphology.family === "amphibian" && !isFront ? -1 : isFront ? -0.025 : digitigrade ? 0.09 : 0.035,
      morphology.family === "amphibian" && !isFront ? -0.12 : -1,
    );
    context.save();
    context.globalAlpha = (far ? 0.48 : 1) * (1 - pose.bodySlide);
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
  if (morphology.tailLength > 0) context.stroke();

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
  context.save();
  context.translate(headX, headY);
  context.rotate((pose.forwardRoll + pose.cartwheel) * Math.PI * 2);
  context.translate(-headX, -headY);
  context.fillStyle = "rgba(64, 47, 34, 0.1)";
  context.strokeStyle = ink;
  context.lineWidth = 2;
  context.beginPath();
  context.ellipse(headX, headY, 15 * morphology.headScale, 18 * morphology.headScale, -0.28, 0, Math.PI * 2);
  context.fill();
  context.stroke();
  const miniHead = 18 * morphology.headScale;
  if (morphology.family === "amphibian") {
    for (const offset of [-0.3, 0.3]) {
      context.beginPath(); context.arc(headX + miniHead * offset, headY - miniHead * 0.5, miniHead * 0.27, 0, Math.PI * 2); context.stroke();
    }
  } else if (morphology.family === "elephant") {
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
  } else if (["rodent", "ceratopsian"].includes(morphology.family)) {
    drawNewSpeciesHead(context, headX, headY, miniHead, morphology.family, [ink, ink, "#bd987e", ink, "#e6d4ad"]);
  } else if (morphology.family === "camel") {
    context.beginPath();
    context.ellipse(headX + miniHead * 0.65, headY + miniHead * 0.24, miniHead * 0.7, miniHead * 0.32, -0.05, 0, Math.PI * 2);
    context.stroke();
  }
  context.fillStyle = ink;
  context.beginPath();
  context.arc(headX + miniHead * 0.18, headY - miniHead * 0.18, 1.2, 0, Math.PI * 2);
  context.fill();
  context.restore();

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
  const duration = quadrupedScoreTiming(state).durations[step] / 16;
  if (duration > 0.13) {
    context.fillStyle = ink;
    context.font = "bold 9px monospace";
    context.textAlign = "left";
    context.fillText(`${Number(duration.toFixed(2))}b`, 5, 10);
  }
}

function editCall(row, step, direction = 1, clear = false) {
  const levels = [0, 0.58, 1];
  const value = state.callPattern[row][step];
  state.callPattern[row][step] = clear ? 0 : levels[mod((value <= 0 ? 0 : value < 0.8 ? 1 : 2) + direction, 3)];
  rememberMode(); renderGridState(); resetAudioSchedule();
  announce(`${quadrupedCalls(state.animalId)[row].label}, frame ${step + 1}: ${state.callPattern[row][step] ? "call" : "rest"}.`);
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
    copy.textContent = lane.label.replace(" foot", "");
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

  for (let callRow = 0; callRow < 3; callRow += 1) {
    const row = callRow + 4;
    const rowElement = document.createElement("div");
    rowElement.className = "quadruped-grid-row quadruped-call-row";
    rowElement.setAttribute("role", "row");
    rowElement.setAttribute("aria-rowindex", String(row + 2));
    const label = document.createElement("span");
    label.className = "quadruped-grid-row-label";
    label.setAttribute("role", "rowheader");
    label.setAttribute("aria-colindex", "1");
    laneLabelElements.set(`call-${callRow}`, label);
    rowElement.append(label);
    for (let step = 0; step < 16; step += 1) {
      const cell = document.createElement("span");
      cell.setAttribute("role", "gridcell");
      cell.setAttribute("aria-colindex", String(step + 2));
      const button = createGridButton(row, step, `Call ${callRow + 1}, frame ${step + 1}`);
      button.className = "quadruped-grid-cell";
      button.dataset.callRow = String(callRow);
      button.style.setProperty("--lane-color", ["#ed9edd", "#c6adea", "#9cdddf"][callRow]);
      button.addEventListener("click", event => editCall(callRow, step, event.shiftKey ? -1 : 1));
      cell.append(button); rowElement.append(cell);
      gridControls.push({ button, row, callRow, step });
    }
    fragment.append(rowElement);
  }
  $("sequenceGrid").replaceChildren(fragment);
  $("sequenceGrid").setAttribute("aria-rowcount", "8");
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
  } else if ((event.key === "Delete" || event.key === "Backspace") && row >= 4) {
    event.preventDefault();
    editCall(row - 4, step, 1, true);
    return;
  } else {
    return;
  }
  event.preventDefault();
  nextRow = clamp(nextRow, -1, 6);
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
  quadrupedCalls(state.animalId).forEach((call, row) => {
    const label = laneLabelElements.get(`call-${row}`);
    if (label) label.textContent = call.label;
  });
  for (const lane of QUADRUPED_LANES) {
    const label = laneLabelElements.get(lane.id);
    if (label) label.textContent = lane.label.replace(" foot", "");
  }
  for (const control of gridControls) {
    const selected = control.step === selectedStep;
    control.button.dataset.selected = String(selected);
    if (control.frame) {
      drawCabinetPose(control.canvas, control.step);
      const pose = deriveQuadrupedPose(state, control.step + 0.0001);
      const duration = Number((quadrupedScoreTiming(state).durations[control.step] / 16).toFixed(3));
      const supportLabel = pose.bodySlide > 0.85 ? "body sliding" : pose.airborne ? "airborne" : `${pose.groundSupportCount} feet supporting`;
      control.button.setAttribute("aria-label", `Motion-study frame ${control.step + 1}, ${supportLabel}, ${duration} beats.`);
      continue;
    }
    if (control.callRow !== undefined) {
      const value = state.callPattern[control.callRow][control.step];
      control.button.dataset.level = value <= 0 ? "none" : value < 0.8 ? "soft" : "strong";
      control.button.style.setProperty("--level", String(value));
      control.button.textContent = value <= 0 ? "·" : value < 0.8 ? "○" : "●";
      control.button.setAttribute("aria-pressed", value <= 0 ? "false" : value < 0.8 ? "mixed" : "true");
      control.button.setAttribute("aria-label", `${quadrupedCalls(state.animalId)[control.callRow].label}, frame ${control.step + 1}: ${value <= 0 ? "rest" : value < 0.8 ? "soft call" : "strong call"}. Activate to cycle.`);
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

function syncEnsembleControls() {
  document.querySelectorAll("[data-group-mode]").forEach(button => button.setAttribute("aria-pressed", String(button.dataset.groupMode === groupMode)));
  document.querySelectorAll("[data-actor-index]").forEach(button => {
    const index = Number(button.dataset.actorIndex);
    const actor = actors[index];
    button.hidden = !actor || (groupMode === "solo" && index !== selectedActor);
    button.setAttribute("aria-pressed", String(index === selectedActor));
    button.textContent = String(index + 1);
    const label = `Edit animal ${index + 1}: ${actor ? quadrupedAnimal(actor.score.animalId).label : ""}`;
    button.setAttribute("aria-label", label);
    button.title = label;
  });
  $("scatterButton").disabled = groupMode === "solo";
  $("sequenceTitle").textContent = `Score ${selectedActor + 1}`;
  for (const key of ["grain", "cavern"]) {
    $(key).value = String(world[key]);
    setOutput($(key + "Out"), `${Math.round(world[key] * 100)}%`);
  }
}

function syncAllControls({ grid = true } = {}) {
  shareGroupControls();
  syncEnsembleControls();
  if (graph && graph.materialBus.surfaceId !== state.surfaceId) {
    applyMaterialProfile(graph.materialBus, quadrupedTerrain(state.surfaceId), graph.context.currentTime);
  }
  const animal = quadrupedAnimal(state.animalId);
  const behavior = quadrupedBehavior(state.behaviorId);
  syncTheme();
  if (behaviorButtonAnimalId !== state.animalId) buildBehaviorOptions();
  $("animalSelect").value = state.animalId;
  $("behaviorSelect").value = state.behaviorId;
  $("soundSkinSelect").value = soundSkinId;
  $("visualSkinSelect").value = visualSkinId;
  $("tempo").value = String(state.tempoBpm);
  document.querySelectorAll("[data-pace-ratio]").forEach((button) => button.setAttribute("aria-pressed", String(Number(button.dataset.paceRatio) === state.paceRatio)));
  $("suspensionBeats").value = String(state.suspensionBeats);
  const supportsRest = Boolean(quadrupedScoreTiming(state).window);
  $("suspensionBeats").disabled = !supportsRest;
  $("suspensionControl").hidden = !supportsRest;
  $("suspensionBeats").setAttribute("aria-valuetext", `${state.suspensionBeats} extra beats`);
  setOutput($("suspensionOut"), `Rest · ${state.suspensionBeats}b`);
  suspensionKnob?.update();
  setOutput($("phraseLength"), `${Number(quadrupedScoreTiming(state).beats.toFixed(2))} beats / loop`);
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

function headPerformanceSignals(pose, score = state) {
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
  drawQuadrupedFootprint(context, {
    skinId: visualSkinId, x, y: groundY + scale * 0.02, color, alpha: strength,
    radiusX: scale * (0.12 + (1 - strength) * 0.32), radiusY: scale * 0.045, pulse: true,
  });
}

function drawLeg(context, id, hipX, hipY, centerX, groundY, bodyScale, pose, color, far, score = state) {
  if (pose.bodySlide > 0.85) return;
  const leg = pose.legs[id];
  const morphology = quadrupedAnimal(score.animalId).morphology;
  const lift = leg.lift;
  const impact = leg.impact;
  const isFront = id.startsWith("front");
  const groundHoofX = centerX + leg.footX * bodyScale * 0.74;
  const contactGroundY = groundY - (leg.footWorldY - pose.bodyGroundHeight) * bodyScale * 0.74;
  const groundHoofY = contactGroundY - lift * bodyScale * 0.46;
  const farSpread = id.endsWith("left") ? -0.07 : 0.07;
  let hoofX = lerp(groundHoofX, hipX + bodyScale * ((isFront ? -0.16 : 0.18) + farSpread), pose.rollTuck);
  let hoofY = lerp(groundHoofY, hipY + bodyScale * (0.24 + farSpread), pose.rollTuck);
  if (pose.cartwheel > 0 && !leg.grounded) {
    const angle = pose.cartwheel * Math.PI * 2 + (isFront ? -0.7 : 0.7) + (far ? -0.28 : 0.28);
    const reach = bodyScale * (isFront ? morphology.frontUpper + morphology.frontLower : morphology.hindUpper + morphology.hindLower) * 0.9;
    hoofX = hipX - Math.sin(angle) * reach;
    hoofY = hipY + Math.cos(angle) * reach;
  }
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
    morphology.family === "amphibian" && !isFront ? -1 : isFront ? -0.025 : isDigitigrade ? 0.09 : 0.035,
    morphology.family === "amphibian" && !isFront ? -0.12 : -1,
  );
  context.save();
  context.globalAlpha = (far ? 0.56 : 1) * (1 - pose.bodySlide);
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
  // A fuller upper limb tapers through the lower limb into the ankle.
  context.lineWidth = Math.max(2.5, bodyScale * morphology.legWidth * 1.65);
  context.beginPath();
  context.moveTo(hipX, hipY);
  context.lineTo(chain.kneeX, chain.kneeY);
  context.stroke();
  if (morphology.family === "amphibian" && isHind) {
    context.lineWidth = bodyScale * 0.27;
    context.beginPath(); context.moveTo(hipX, hipY);
    context.lineTo(chain.kneeX, chain.kneeY); context.stroke();
    context.lineWidth = bodyScale * 0.025;
    context.strokeStyle = quadrupedAnimal(score.animalId).palette[4];
    context.beginPath(); context.moveTo(hipX, hipY - bodyScale * 0.07);
    context.lineTo(chain.kneeX, chain.kneeY - bodyScale * 0.04); context.stroke();
    context.strokeStyle = color;
  }
  context.lineWidth = Math.max(2, bodyScale * morphology.legWidth * 1.12);
  context.beginPath();
  context.moveTo(chain.kneeX, chain.kneeY);
  context.lineTo(chain.ankleX, chain.ankleY);
  context.stroke();
  context.strokeStyle = laneById.get(id).color;
  context.fillStyle = laneById.get(id).color;
  context.lineWidth = Math.max(2.5, bodyScale * morphology.footWidth * 0.72);
  const footHalf = bodyScale * morphology.footWidth * 0.5;
  if (morphology.family === "amphibian") {
    context.lineWidth = Math.max(1, bodyScale * 0.018);
    context.beginPath(); context.moveTo(chain.footX - footHalf, chain.footY);
    for (let toe = 0; toe < (isFront ? 4 : 5); toe += 1) context.lineTo(chain.footX + footHalf * (0.3 + (toe % 2 ? 0.4 : 1.3)), chain.footY + (toe - 2) * bodyScale * 0.025);
    context.closePath(); context.globalAlpha *= 0.8; context.fill(); context.stroke();
  } else if (morphology.family === "goat") {
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
  const callStrength = transportPlaying ? pose.headPerformance?.strength ?? 0 : 0;
  if (callStrength > 0.02) {
    context.save(); context.fillStyle = "#172017";
    context.beginPath(); context.ellipse(headX + facing * size * 0.3, headY + size * 0.2, size * 0.15, size * (0.02 + callStrength * 0.15), 0, 0, Math.PI * 2); context.fill(); context.restore();
  }
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

function drawNewSpeciesHead(context, x, y, size, family, palette) {
  context.save();
  context.translate(x, y);
  context.scale(size, size);
  context.lineWidth = 0.035;
  context.strokeStyle = palette[3];
  context.fillStyle = palette[0];
  if (family === "ceratopsian") {
    // Broad scalloped parietal frill behind the forward-facing skull.
    context.beginPath();
    for (let i = 0; i <= 20; i += 1) {
      const angle = Math.PI * 2 * i / 20;
      const radius = i % 2 ? 0.91 : 1;
      const px = -0.39 + Math.cos(angle) * 0.58 * radius;
      const py = -0.14 + Math.sin(angle) * 0.92 * radius;
      if (i === 0) context.moveTo(px, py); else context.lineTo(px, py);
    }
    context.closePath(); context.fill(); context.stroke();
    context.fillStyle = palette[1];
    context.beginPath(); context.ellipse(-0.4, -0.15, 0.34, 0.66, -0.1, 0, Math.PI * 2); context.fill();
    context.fillStyle = palette[0];
    context.beginPath();
    context.moveTo(-0.35, -0.43); context.quadraticCurveTo(0.25, -0.45, 0.78, -0.08);
    context.lineTo(0.92, 0.27); context.lineTo(0.62, 0.46);
    context.quadraticCurveTo(-0.1, 0.59, -0.5, 0.27);
    context.closePath(); context.fill(); context.stroke();
    context.fillStyle = palette[4];
    for (const [hx, hy, length] of [[-0.16, -0.38, 0.94], [0.11, -0.32, 0.86], [0.68, -0.02, 0.32]]) {
      context.beginPath(); context.moveTo(hx - 0.1, hy + 0.08);
      context.quadraticCurveTo(hx + length * 0.36, hy - length * 0.39, hx + length, hy - length * 0.5);
      context.quadraticCurveTo(hx + length * 0.46, hy - 0.01, hx + 0.12, hy + 0.11);
      context.closePath(); context.fill(); context.stroke();
    }
    context.fillStyle = palette[3];
    context.beginPath(); context.moveTo(0.8, 0.14); context.lineTo(0.96, 0.28); context.lineTo(0.72, 0.36); context.closePath(); context.fill();
  } else if (family === "rodent") {
    for (const [ex, ey, radius] of [[-0.24, -0.51, 0.38], [0.19, -0.53, 0.32]]) {
      context.fillStyle = palette[0];
      context.beginPath(); context.arc(ex, ey, radius, 0, Math.PI * 2); context.fill(); context.stroke();
      context.fillStyle = palette[2];
      context.beginPath(); context.arc(ex, ey, radius * 0.7, 0, Math.PI * 2); context.fill();
    }
    context.fillStyle = palette[0];
    context.beginPath();
    context.moveTo(-0.4, -0.24); context.quadraticCurveTo(0.04, -0.58, 0.46, -0.15);
    context.lineTo(0.95, 0.23); context.quadraticCurveTo(0.24, 0.54, -0.42, 0.29);
    context.closePath(); context.fill(); context.stroke();
    context.fillStyle = palette[2];
    context.beginPath(); context.arc(0.92, 0.22, 0.085, 0, Math.PI * 2); context.fill();
    context.strokeStyle = palette[4]; context.lineWidth = 0.018;
    for (const offset of [-0.18, 0, 0.18]) {
      context.beginPath(); context.moveTo(0.55, 0.22); context.lineTo(1.25, 0.2 + offset); context.stroke();
    }
  }
  context.restore();
}

function drawHeadAura(context, headX, headY, size, pose, performanceState, score = state) {
  const strength = clamp(performanceState.strength);
  if (strength < 0.02) return;
  const animal = quadrupedAnimal(score.animalId);
  context.save();
  context.globalAlpha = 0.2 + strength * 0.55;
  context.strokeStyle = animal.palette[2];
  context.lineWidth = Math.max(1, size * 0.025);
  context.shadowColor = animal.palette[2];
  context.shadowBlur = size * 0.3;
  const rays = score.animalId === "unicorn" ? 9 : score.animalId === "elephant" ? 5 : 7;
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

function drawAnimal(context, pose, width, height, groundY, score = state) {
  if (drawQuadrupedVisualSkin(context, pose, width, height, groundY, { ...score, visualSkinId }, { playing: transportPlaying })) return;
  const animal = quadrupedAnimal(score.animalId);
  const morphology = animal.morphology;
  const performanceState = headPerformanceSignals(pose, score);
  const centerX = width * 0.5;
  const scale = Math.min(height * 0.27, width * 0.145) * animal.bodyScale;
  const isFeline = morphology.family === "feline";
  const isLizard = morphology.family === "lizard";
  const isGiraffe = morphology.family === "giraffe";
  const bodyY = groundY - scale * lerp(morphology.clearance + pose.bodyLift * 0.38, morphology.bodyHeight * 0.48, pose.bodySlide);
  const nominalBodyWidth = scale * morphology.bodyWidth;
  const nominalBodyHeight = scale * morphology.bodyHeight;
  const spineGather = isFeline ? clamp(pose.spineFlex, -0.2, 0.2) : 0;
  const bodyWidth = nominalBodyWidth * (1 - spineGather * 0.8);
  const bodyHeight = nominalBodyHeight * (1 + Math.max(0, spineGather) * 0.9);
  const headSize = scale * morphology.headScale;
  const bodyWave = isLizard ? Math.sin(pose.position / QUADRUPED_STEP_COUNT * Math.PI * 2) * 0.11 : 0;
  const bodyRotation = pose.bodyPitch + pose.bodyRoll * 0.22 - pose.rearBalance * 0.58 + bodyWave
    + pose.forwardRoll * Math.PI * 2 + pose.cartwheel * Math.PI * 2;
  const bodyPoint = (localX, localY) => ({
    x: centerX + localX * Math.cos(bodyRotation) - localY * Math.sin(bodyRotation),
    y: bodyY + localX * Math.sin(bodyRotation) + localY * Math.cos(bodyRotation),
  });
  const headAnchor = bodyPoint(scale * morphology.headForward, -scale * morphology.headRise);
  const headX = headAnchor.x;
  const headY = headAnchor.y - pose.headLift * scale * (isLizard ? 0.06 : 0.16)
    + pose.headNod * scale * 0.12 - performanceState.headToss * scale * 0.13
    - performanceState.strength * scale * 0.065 + performanceState.neckSway * scale * 0.06;
  const hips = {
    "rear-left": bodyPoint(-bodyWidth * 0.4, bodyHeight * 0.2 * morphology.haunch),
    "rear-right": bodyPoint(-bodyWidth * 0.37, bodyHeight * 0.22 * morphology.haunch),
    "front-left": bodyPoint(bodyWidth * 0.37, bodyHeight * 0.18 * morphology.shoulder),
    "front-right": bodyPoint(bodyWidth * 0.4, bodyHeight * 0.2 * morphology.shoulder),
  };
  drawLeg(context, "rear-left", hips["rear-left"].x, hips["rear-left"].y, centerX, groundY, scale, pose, animal.palette[1], true, score);
  drawLeg(context, "front-left", hips["front-left"].x, hips["front-left"].y, centerX, groundY, scale, pose, animal.palette[1], true, score);

  context.save();
  context.translate(centerX, bodyY);
  context.rotate(bodyRotation);
  context.fillStyle = animal.palette[0];
  context.strokeStyle = animal.palette[3];
  context.lineWidth = Math.max(2, scale * 0.027);
  context.shadowColor = "rgba(0, 0, 0, 0.35)";
  context.shadowBlur = scale * 0.1;
  const coat = context.createLinearGradient(0, -bodyHeight * 0.55, 0, bodyHeight * 0.6);
  coat.addColorStop(0, animal.palette[4]);
  coat.addColorStop(0.22, animal.palette[0]);
  coat.addColorStop(1, animal.palette[1]);
  context.fillStyle = coat;
  context.beginPath();
  context.moveTo(-bodyWidth * 0.53, bodyHeight * 0.04);
  context.bezierCurveTo(-bodyWidth * 0.5, -bodyHeight * 0.46 * morphology.haunch, -bodyWidth * 0.24, -bodyHeight * 0.58, 0, -bodyHeight * 0.5);
  context.bezierCurveTo(bodyWidth * 0.25, -bodyHeight * 0.54, bodyWidth * 0.48, -bodyHeight * 0.44 * morphology.shoulder, bodyWidth * 0.53, -bodyHeight * 0.02);
  context.bezierCurveTo(bodyWidth * 0.5, bodyHeight * 0.48, bodyWidth * 0.2, bodyHeight * 0.52, 0, bodyHeight * (isFeline || morphology.family === "canid" ? 0.24 : 0.48));
  context.bezierCurveTo(-bodyWidth * 0.25, bodyHeight * 0.52, -bodyWidth * 0.5, bodyHeight * 0.45, -bodyWidth * 0.53, bodyHeight * 0.04);
  context.closePath();
  context.fill();
  context.stroke();
  context.save();
  context.clip();
  context.shadowBlur = 0;
  const texturedSkin = ["elephant", "ceratopsian", "lizard", "amphibian"].includes(morphology.family);
  context.strokeStyle = animal.palette[1];
  context.fillStyle = animal.palette[1];
  context.lineWidth = Math.max(0.6, scale * 0.006);
  context.globalAlpha = texturedSkin ? 0.38 : 0.2;
  for (let mark = 0; mark < (texturedSkin ? 55 : 32); mark += 1) {
    const x = (mod(mark * 0.618033, 1) - 0.5) * bodyWidth;
    const y = (mod(mark * 0.3819, 1) - 0.5) * bodyHeight;
    context.beginPath();
    if (morphology.family === "elephant") {
      context.moveTo(x, y); context.quadraticCurveTo(x - scale * 0.045, y + scale * 0.015, x - scale * 0.02, y + scale * 0.07); context.stroke();
    } else if (texturedSkin) {
      context.ellipse(x, y, scale * (0.014 + (mark % 3) * 0.006), scale * 0.012, 0.2, 0, Math.PI * 2); context.fill();
    } else {
      context.moveTo(x, y); context.lineTo(x - scale * 0.035, y + scale * 0.014); context.stroke();
    }
  }
  context.restore();
  if (score.animalId === "gazelle") {
    context.fillStyle = animal.palette[2];
    context.beginPath();
    context.ellipse(0, bodyHeight * 0.2, bodyWidth * 0.42, bodyHeight * 0.12, 0, 0, Math.PI * 2);
    context.fill();
  }
  if (score.animalId === "cheetah") {
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
  if (score.animalId === "giraffe") {
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
  if (score.animalId === "unicorn") {
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
    const neckControl = bodyPoint(scale * (morphology.headForward - morphology.neckLength * (morphology.family === "camel" ? 0.38 : 0.24)), -scale * morphology.headRise * 0.58);
    const neckControlX = neckControl.x;
    const neckControlY = neckControl.y;
    const neckEndX = headX - headSize * (0.16 * Math.cos(bodyRotation) + 0.28 * Math.sin(bodyRotation));
    const neckEndY = headY + headSize * (0.28 * Math.cos(bodyRotation) - 0.16 * Math.sin(bodyRotation));
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
  const tailAngle = pose.tailAngle + performanceState.strength * Math.sin((performanceState.progress ?? 1) * Math.PI * 4) * 0.55;
  context.save();
  context.translate(tailStartX, tailStartY);
  context.rotate(bodyRotation);
  context.translate(-tailStartX, -tailStartY);
  context.strokeStyle = score.animalId === "unicorn" ? animal.palette[2] : animal.palette[1];
  context.lineWidth = Math.max(morphology.family === "rodent" ? 1 : 3, scale * (
    morphology.family === "elephant" ? 0.065
      : morphology.family === "equid" ? 0.085
        : morphology.family === "rodent" ? 0.028 : morphology.family === "ceratopsian" || isLizard ? 0.13 : 0.04
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
  if (morphology.family === "ceratopsian" || isLizard) {
    // A muscular root tapering to a point, not a tube of constant thickness.
    context.lineTo(tailStartX - scale * morphology.tailLength, tailStartY + Math.sin(tailAngle) * scale * (isLizard ? 0.28 : 0.48));
    context.bezierCurveTo(tailStartX - scale * 0.55, tailStartY + scale * 0.18, tailStartX - scale * 0.26, tailStartY + scale * 0.12, tailStartX, tailStartY + scale * 0.13);
    context.closePath();
    context.fillStyle = animal.palette[1];
    context.fill();
  } else if (morphology.tailLength > 0) {
    context.stroke();
  }
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

  drawLeg(context, "rear-right", hips["rear-right"].x, hips["rear-right"].y, centerX, groundY, scale, pose, animal.palette[0], false, score);
  drawLeg(context, "front-right", hips["front-right"].x, hips["front-right"].y, centerX, groundY, scale, pose, animal.palette[0], false, score);

  context.save();
  if (pose.forwardRoll > 0 || pose.cartwheel > 0) {
    context.translate(headX, headY);
    context.rotate((pose.forwardRoll + pose.cartwheel) * Math.PI * 2);
    context.translate(-headX, -headY);
  }
  context.fillStyle = animal.palette[0];
  context.strokeStyle = animal.palette[3];
  context.lineWidth = Math.max(2, scale * 0.027);
  if (score.animalId === "frog") {
    const pouch = transportPlaying ? pose.headPerformance?.throatPulse ?? 0 : 0;
    context.fillStyle = animal.palette[4];
    context.beginPath();
    context.ellipse(headX + headSize * 0.16, headY + headSize * (0.24 + pouch * 0.12), headSize * (0.5 + pouch * 0.18), headSize * (0.21 + pouch * 0.42), 0, 0, Math.PI * 2);
    context.fill(); context.stroke();
    context.fillStyle = animal.palette[0];
    context.beginPath(); context.ellipse(headX, headY - headSize * 0.07, headSize * 0.77, headSize * 0.4, -0.06, 0, Math.PI * 2); context.fill(); context.stroke();
    for (const eyeOffset of [-0.26, 0.3]) {
      const eyeX = headX + headSize * eyeOffset;
      const eyeY = headY - headSize * (eyeOffset < 0 ? 0.44 : 0.4);
      context.fillStyle = animal.palette[0];
      context.beginPath(); context.arc(eyeX, eyeY, headSize * 0.24, 0, Math.PI * 2); context.fill(); context.stroke();
      context.fillStyle = "#d4b950";
      context.beginPath(); context.arc(eyeX + headSize * 0.035, eyeY, headSize * 0.16, 0, Math.PI * 2); context.fill();
      context.fillStyle = "#101909";
      context.beginPath(); context.ellipse(eyeX + headSize * 0.065, eyeY, headSize * 0.125, headSize * 0.055, 0, 0, Math.PI * 2); context.fill();
      context.fillStyle = "#ffffe6"; context.beginPath(); context.arc(eyeX + headSize * 0.095, eyeY - headSize * 0.065, headSize * 0.035, 0, Math.PI * 2); context.fill();
    }
    context.strokeStyle = animal.palette[3]; context.lineWidth = Math.max(1, headSize * 0.025);
    context.beginPath(); context.moveTo(headX - headSize * 0.52, headY + headSize * 0.1);
    context.quadraticCurveTo(headX + headSize * 0.24, headY + headSize * 0.31, headX + headSize * 0.72, headY + headSize * 0.03); context.stroke();
    context.fillStyle = animal.palette[3]; context.beginPath(); context.arc(headX + headSize * 0.6, headY - headSize * 0.12, headSize * 0.028, 0, Math.PI * 2); context.fill();
  } else if (score.animalId === "elephant") {
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
        const earHeight = score.animalId === "horse" ? 0.42 : 0.72;
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
    if (score.animalId === "unicorn") {
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
    } else if (["rodent", "ceratopsian"].includes(morphology.family)) {
      drawNewSpeciesHead(context, headX, headY, headSize, morphology.family, animal.palette);
    } else if (morphology.family === "equid") {
      const muzzleX = headX + headSize * 0.42;
      const muzzleY = headY + headSize * 0.16;
      context.fillStyle = score.animalId === "horse" ? animal.palette[1] : animal.palette[4];
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
    } else if (score.animalId === "gazelle") {
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
      if (score.animalId === "cheetah") {
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
  drawHeadAura(context, headX, headY, headSize, pose, performanceState, score);
}

function drawScene(now) {
  const { width, height } = canvasMetrics;
  if (width <= 1 || height <= 1) return;
  const motorSnapshot = transportPlaying
    ? materializeMotor(now)
    : quadrupedMotorSnapshot(state, motor);
  const previewingStep = !transportPlaying && selectedStep !== motorSnapshot.frame;
  const position = previewingStep
    ? Math.floor(motorSnapshot.position / QUADRUPED_STEP_COUNT) * QUADRUPED_STEP_COUNT + selectedStep + 0.0001
    : motorSnapshot.position;
  const pose = deriveQuadrupedPose(state, position, previewingStep ? null : motorSnapshot);
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
  canvas.dataset.visualSkin = visualSkinId;
  canvas.dataset.soundSkin = soundSkinId;
  stageWrap.dataset.visualSkin = visualSkinId;
  const paperSkin = visualSkinId === "motion-card";
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
  lastFootprintHits = [];
  if (groupMode === "solo") {
    // The stopped score may preview a selected card. Scenery keeps the actual
    // travelled distance so pausing never wraps the world back to one cycle.
    drawQuadrupedEnvironment(drawing, {
      skinId: visualSkinId, width, height, groundY, groundAt: screenGroundYAtX,
      worldX: motorSnapshot.position / QUADRUPED_STEP_COUNT * state.stride,
      worldScale, animal, surface, compact: Boolean(compactMedia?.matches),
    });
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
        drawQuadrupedFootprint(drawing, {
          skinId: visualSkinId, x, y: footprintY, color: lane.color, laneId: contact.id,
          alpha: opacity * (0.45 + contact.intensity * 0.55),
          radiusX: stageAnimalScale * (contact.id.startsWith("front") ? 0.095 : 0.11),
          radiusY: stageAnimalScale * 0.036,
        });
        drawing.save(); drawing.translate(x, footprintY);
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
  }
  const visibleActors = activeActorIndices();
  canvas.dataset.actorCount = String(visibleActors.length);
  canvas.dataset.selectedActor = String(selectedActor);
  canvas.dataset.call = pose.headPerformance?.kind ?? "";
  canvas.dataset.callStrength = String(pose.headPerformance?.strength ?? 0);
  canvas.dataset.actorPositions = JSON.stringify(visibleActors.map(index => Number(actors[index].motor.position.toFixed(3))));
  canvas.dataset.actorTempos = JSON.stringify(visibleActors.map(index => actors[index].score.tempoBpm));
  canvas.dataset.stairLevel = String(worldSoundAt().level);
  if (groupMode === "solo") {
    drawAnimal(drawing, pose, width, height, groundY);
  } else {
    // Three independently travelling lanes in one field. Each local camera
    // follows its own planted anchors; changing the editor never moves a body.
    const laneWidth = width / 3;
    visibleActors.forEach(index => {
      const actor = actors[index];
      const snapshot = quadrupedMotorSnapshot(actor.score, actor.motor);
      const actorPose = deriveQuadrupedPose(actor.score, actor.motor.position, snapshot);
      const actorAnimal = quadrupedAnimal(actor.score.animalId);
      const localScale = Math.min(height * 0.27, laneWidth * 1.6 * 0.145) * actorAnimal.bodyScale;
      const localWorldScale = localScale * 0.74;
      const localWorldX = actor.motor.position / 16 * actor.score.stride;
      const localGround = height * (["giraffe", "camel"].includes(actor.score.animalId) ? 0.81 : 0.74);
      const floorAt = x => localGround - (quadrupedGroundHeightAtWorldX(actor.score.groundProfileId, localWorldX + (x - laneWidth / 2) / localWorldScale) - actorPose.bodyGroundHeight) * localWorldScale;
      drawing.save(); drawing.translate(index * laneWidth, 0);
      drawing.beginPath(); drawing.rect(0, 0, laneWidth, height); drawing.clip();
      drawQuadrupedEnvironment(drawing, {
        skinId: visualSkinId, width: laneWidth, height, groundY: localGround,
        groundAt: floorAt, worldX: localWorldX, worldScale: localWorldScale,
        animal: actorAnimal, surface: quadrupedTerrain(actor.score.surfaceId),
        compact: Boolean(compactMedia?.matches),
      });
      for (let ordinal = Math.floor(actor.motor.position) - 24; ordinal <= actor.motor.position; ordinal += 1) {
        for (const contact of quadrupedSequenceEvent(actor.score, ordinal).contacts) {
          const foot = quadrupedFootCycleState(actor.score, contact.id, ordinal);
          const x = laneWidth / 2 + (foot.anchorWorldX - localWorldX) * localWorldScale;
          drawQuadrupedFootprint(drawing, {
            skinId: visualSkinId, x,
            y: localGround - (foot.anchorWorldY - actorPose.bodyGroundHeight) * localWorldScale + 2,
            color: contact.color, laneId: contact.id,
            alpha: Math.max(0.06, 0.55 - (actor.motor.position - ordinal) / 48),
            radiusX: localScale * 0.09, radiusY: 2,
          });
        }
      }
      for (const lane of QUADRUPED_LANES) {
        const leg = actorPose.legs[lane.id];
        if (!leg.grounded) continue;
        const x = laneWidth / 2 + leg.footX * localWorldScale;
        drawQuadrupedFootprint(drawing, {
          skinId: visualSkinId, x,
          y: localGround - (leg.footWorldY - actorPose.bodyGroundHeight) * localWorldScale + 2,
          color: lane.color, laneId: lane.id, radiusX: localScale * 0.1, radiusY: 2,
        });
      }
      drawing.save(); drawing.translate(-laneWidth * 0.3, 0);
      drawAnimal(drawing, actorPose, laneWidth * 1.6, height, localGround, actor.score);
      drawing.restore();
      drawing.font = "12px ui-monospace, monospace"; drawing.textAlign = "center";
      drawing.fillStyle = paperSkin ? "#463c2b" : index === selectedActor ? "#eeffb8" : "#c9d8cc";
      drawing.fillText(`${index + 1} · ${actorAnimal.label}`, laneWidth / 2, height - 12);
      drawing.restore();
    });
  }

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
  canvas.dataset.bodySlide = String(snapshot.bodySlide);
  canvas.dataset.clockPosition = snapshot.clockPosition.toFixed(4);
  canvas.dataset.height = snapshot.height.toFixed(4);
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
    programSelectedFoot(lane.id, null, event.shiftKey ? -1 : 1);
  }
}

function handleGlobalKeydown(event) {
  if (event.defaultPrevented || event.repeat || event.ctrlKey || event.altKey || event.metaKey) return;
  const target = event.target;
  if (target?.closest?.("input, select, textarea, button, a, summary, [contenteditable='true'], [role='slider'], [role='grid']")) return;
  if (!/^[1-4]$/.test(event.key)) return;
  event.preventDefault();
  const lane = QUADRUPED_LANES[Number(event.key) - 1];
  programSelectedFoot(lane.id, null, event.shiftKey ? -1 : 1);
}

function bindControls() {
  document.querySelectorAll("[data-group-mode]").forEach(button => button.addEventListener("click", () => setGroupMode(button.dataset.groupMode)));
  document.querySelectorAll("[data-actor-index]").forEach(button => button.addEventListener("click", () => selectActor(Number(button.dataset.actorIndex))));
  $("scatterButton").addEventListener("click", scatterGroup);
  for (const key of ["grain", "cavern"]) $(key).addEventListener("input", () => {
    world = sanitizeQuadrupedWorld({ ...world, [key]: Number($(key).value) });
    syncEnsembleControls();
  });
  $("newGrainButton").addEventListener("click", () => {
    world = sanitizeQuadrupedWorld({ ...world, seed: world.seed + 1 });
    announce("New contact texture.");
  });
  $("callPhraseButton").addEventListener("click", () => {
    state.callPattern = emptyQuadrupedCalls();
    [0, 6, 12].forEach((step, row) => { state.callPattern[row][step] = 0.58; });
    rememberMode(); renderGridState(); resetAudioSchedule();
    announce("Three calls written on frames 1, 7 and 13.");
  });
  $("clearCallsButton").addEventListener("click", () => {
    state.callPattern = emptyQuadrupedCalls();
    rememberMode(); renderGridState(); resetAudioSchedule();
    announce("Calls cleared; feet unchanged.");
  });
  $("audioButton").addEventListener("click", toggleAudio);
  $("playButton").addEventListener("click", toggleTransport);
  $("restartButton").addEventListener("click", restartTransport);
  $("tempo").addEventListener("input", () => updateStateValue("tempoBpm", $("tempo").value));
  document.querySelectorAll("[data-pace-ratio]").forEach((button) => button.addEventListener("click", () => updateStateValue("paceRatio", Number(button.dataset.paceRatio))));
  $("suspensionBeats").addEventListener("input", () => updateStateValue("suspensionBeats", Number($("suspensionBeats").value)));
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
  $("animalSelect").addEventListener("change", () => switchAnimal($("animalSelect").value));
  $("behaviorSelect").addEventListener("change", () => switchBehavior($("behaviorSelect").value));
  $("soundSkinSelect").addEventListener("change", () => {
    soundSkinId = $("soundSkinSelect").value;
    releaseAllSources();
    resetAudioSchedule();
  });
  $("visualSkinSelect").addEventListener("change", () => {
    visualSkinId = $("visualSkinSelect").value;
    drawScene(performance.now());
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
  presetController?.destroy();
  suspensionKnob?.destroy();
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

for (const [id, skins] of [["soundSkinSelect", QUADRUPED_SOUND_SKINS], ["visualSkinSelect", QUADRUPED_VISUAL_SKINS]]) {
  for (const skin of skins) $(id).add(new Option(skin.label, skin.id));
}
buildBehaviorOptions();
buildSequenceGrid();
suspensionKnob = enhanceRangeKnob($("suspensionBeats"));
bindControls();
syncAllControls();
setAudioPresentation("off");
presetController = registerHeaderPresets({
  id: "quadruped", presets: QUADRUPED_FULL_PRESETS,
  capture: capturePreset, apply: applyPreset, randomize: randomizeQuadrupedPreset,
  onApplied: () => startTransport(),
});
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

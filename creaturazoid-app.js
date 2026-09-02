import {
  CREATURAZOID_ANATOMY_DESIGNS,
  CREATURAZOID_DYNAMICS,
  CREATURAZOID_LIMITS,
  CREATURAZOID_MAX_STEPS,
  CREATURAZOID_SEQUENCE_PRESETS,
  CREATURAZOID_SOUNDS,
  CREATURAZOID_BODY_PRESETS,
  creaturazoidAnatomyDesign,
  creaturazoidContourOffsets,
  creaturazoidQuickMorphProgress,
  creaturazoidRecommendedSpaceSteps,
  creaturazoidSequencePreset,
  creaturazoidSound,
  creaturazoidSoundForKey,
  creaturazoidState,
  creaturazoidStepEvent,
  creaturazoidStepIntervalSeconds,
  creaturazoidBodyPreset,
  cycleCreaturazoidStep,
  interpolateCreaturazoidMorph,
  resolveCreaturazoidEventState,
  sanitizeCreaturazoidPattern,
  sanitizeCreaturazoidState,
  setCreaturazoidStep,
} from "./src/creaturazoid.js?v=creaturazoid-model-20260902-5";
import {
  ANIMALS,
  CALL_GESTURES,
  CONTROL_LIMITS,
  MODEL_LABELS,
  clamp,
  resolveSourceControls,
  resolveSyrinxPresetGain,
  sampleModulationWave,
} from "./src/syrinx.js?v=creaturazoid-core-20260902-2";
import { connectAudioOutput } from "./src/audio-output-manager.js";
import { unlockAudioContext } from "./src/audio.js";

const $ = (id) => document.getElementById(id);
const canvas = $("stage");
const stageWrap = $("stageWrap");
const drawing = canvas.getContext("2d", { alpha: false, desynchronized: true });
const compactMedia = globalThis.matchMedia?.("(max-width: 720px), (pointer: coarse)");
const prefersReducedMotion = globalThis.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches ?? false;

const MODEL_FAMILY_LABELS = Object.freeze({
  mammal: "two-mass larynx",
  bird: "paired nonlinear syrinx",
  frog: "vocal membranes + sac",
  rodent: "impinging-jet whistle",
});

// Creaturazoid keeps the chest-heavy families forward while restraining the
// crest factor of compact syrinx and whistle sources before shared compression.
const FAMILY_OUTPUT_TRIM = Object.freeze({
  mammal: 1,
  bird: 0.82,
  frog: 0.88,
  rodent: 0.72,
});

const MODULATION_TARGETS = Object.freeze({
  cavity: "cavityCoupling",
  roughness: "roughness",
  beak: "mouthOpening",
  pressure: "pressure",
  split: "asymmetry",
  balance: "sourceBalance",
});

const ANATOMY_RENDER_GEOMETRY = Object.freeze({
  "scapular-wings": Object.freeze({
    code: "T-01",
    skullWidth: 0.55,
    skullHeight: 0.5,
    muzzleWidth: 0.36,
    muzzleLength: 0.18,
    neckLength: 0.34,
    neckWidth: 0.31,
    thoraxWidth: 0.59,
    wingSpan: 0.8,
    wingLift: 0.11,
    wingDrop: 0.22,
    hornType: "prong",
    hornWidth: 0.2,
    hornHeight: 0.34,
    jawDepth: 0.25,
    nasalBridge: 0.28,
  }),
  "costal-glider": Object.freeze({
    code: "C-02",
    skullWidth: 0.5,
    skullHeight: 0.48,
    muzzleWidth: 0.4,
    muzzleLength: 0.17,
    neckLength: 0.43,
    neckWidth: 0.34,
    thoraxWidth: 0.61,
    wingSpan: 0.72,
    wingLift: 0.14,
    wingDrop: 0.19,
    hornType: "antler",
    hornWidth: 0.31,
    hornHeight: 0.28,
    jawDepth: 0.27,
    nasalBridge: 0.34,
  }),
  "branchial-mantle": Object.freeze({
    code: "B-03",
    skullWidth: 0.61,
    skullHeight: 0.45,
    muzzleWidth: 0.43,
    muzzleLength: 0.15,
    neckLength: 0.29,
    neckWidth: 0.4,
    thoraxWidth: 0.66,
    wingSpan: 0.67,
    wingLift: 0.17,
    wingDrop: 0.18,
    hornType: "ram",
    hornWidth: 0.24,
    hornHeight: 0.24,
    jawDepth: 0.3,
    nasalBridge: 0.23,
  }),
});

const ANATOMY_DESIGNS = Object.freeze(CREATURAZOID_ANATOMY_DESIGNS.map((design) => Object.freeze({
  ...ANATOMY_RENDER_GEOMETRY[design.id],
  ...design,
})));

let state = creaturazoidState();
let pattern = sanitizeCreaturazoidPattern(creaturazoidSequencePreset(state.sequencePresetId));
let currentPatternId = state.sequencePresetId;
let modulationTarget = creaturazoidBodyPreset(state.bodyPresetId).modulationTarget ?? "cavity";
let audioContext = null;
let graph = null;
let startingAudio = false;
let telemetry = Object.freeze({ pressure: 0, peak: 0, rms: 0, tractLengthM: 0.17, model: "bird" });
let sequenceRunning = false;
let schedulerTimer = 0;
let nextStepNumber = 0;
let nextStepTime = 0;
let currentStep = -1;
let serialCounter = 0;
let scheduledSteps = [];
let previousScheduledEvent = null;
let activeVisualEvent = null;
let lastHudPaint = -Infinity;
let lastCanvasPaint = -Infinity;
let gridCells = [];
let pointerDrag = null;
let canvasMetrics = Object.freeze({ width: 1, height: 1, dpr: 1, cx: 0.5, cy: 0.5, scale: 1 });

const finiteOr = (value, fallback = 0) => (
  Number.isFinite(Number(value)) ? Number(value) : fallback
);

const formatPercent = (value) => `${Math.round(finiteOr(value) * 100)}%`;
const formatSigned = (value) => {
  const amount = finiteOr(value);
  if (Math.abs(amount) < 0.005) return "center";
  return `${amount > 0 ? "+" : "−"}${Math.round(Math.abs(amount) * 100)}%`;
};
const formatSemitones = (value) => {
  const amount = Math.round(finiteOr(value));
  return `${amount > 0 ? "+" : ""}${amount} st`;
};
const formatFrequency = (value) => (
  value >= 1_000 ? `${(value / 1_000).toFixed(value >= 10_000 ? 0 : 1)} kHz` : `${Math.round(value)} Hz`
);

function announce(message) {
  const liveStatus = $("liveStatus");
  if (!liveStatus) return;
  liveStatus.textContent = "";
  requestAnimationFrame(() => { liveStatus.textContent = message; });
}

function setAudioPresentation(status = "off", message = "") {
  const on = status === "on";
  $("audioButton").setAttribute("aria-pressed", String(on));
  $("audioButton").disabled = status === "starting";
  $("audioState").textContent = status === "starting" ? "starting" : on ? "on" : "off";
  const error = $("audioError");
  error.hidden = !message;
  error.textContent = message;
}

function outputStateValue(element, value) {
  if (!element) return;
  element.value = value;
  element.textContent = value;
}

function copyPattern(source = pattern) {
  return sanitizeCreaturazoidPattern(source, source.length);
}

function withMorphBias(key, value) {
  state = sanitizeCreaturazoidState({
    ...state,
    morphBias: { ...state.morphBias, [key]: clamp(value, -1, 1) },
  }, state);
}

function selectedBodyPreset() {
  return creaturazoidBodyPreset(state.bodyPresetId);
}

function selectedPalette() {
  const source = selectedBodyPreset().palette;
  // The specimen renderer has nine anatomical color roles; compact body
  // palettes deliberately repeat instead of leaving eye, tooth, or lung
  // strokes with an invalid canvas color.
  return Object.freeze(Array.from({ length: 9 }, (_, index) => source[index % source.length]));
}

function setRhythmAccent(index, velocity = 0, sound = null) {
  const palette = selectedPalette();
  const safeIndex = Math.abs(Math.trunc(finiteOr(index, 0))) % palette.length;
  document.body.style.setProperty("--creature-live-color", sound?.color ?? palette[safeIndex]);
  document.body.style.setProperty("--creature-live-force", String(clamp(velocity)));
}

function displaySound() {
  return activeVisualEvent?.sound ?? null;
}

function displayPerformanceState(nowSeconds = audioContext?.currentTime ?? performance.now() / 1_000) {
  const visual = activeVisualEvent;
  if (!visual) {
    return resolveCreaturazoidEventState("growl", {
      state,
      phase: 1,
      elapsedSeconds: 0,
      velocity: 0,
    });
  }
  const phase = clamp((nowSeconds - visual.time) / Math.max(0.001, visual.duration));
  return resolveCreaturazoidEventState(visual.sound.id, {
    state,
    phase,
    elapsedSeconds: Math.max(0, nowSeconds - visual.time),
    velocity: visual.velocity,
  });
}

function applySelectedModulation(performanceState, callElapsedSeconds) {
  const parameter = MODULATION_TARGETS[modulationTarget] ?? "cavityCoupling";
  const limits = CONTROL_LIMITS[parameter];
  if (!limits || state.modulationDepth <= 0) return performanceState;
  const wave = sampleModulationWave(
    state.modulationShape,
    callElapsedSeconds * state.modulationRateHz,
    29,
  );
  const span = limits[1] - limits[0];
  const next = { ...performanceState };
  if (parameter === "pressure") {
    next.pressure = clamp(
      performanceState.pressure * (1 + wave * state.modulationDepth * 0.44),
      ...limits,
    );
  } else {
    next[parameter] = clamp(
      performanceState[parameter] + wave * state.modulationDepth * span * 0.22,
      ...limits,
    );
  }
  return next;
}

function physicalConfiguration(performanceState) {
  const animal = ANIMALS[performanceState.animalId] ?? ANIMALS.raven;
  const body = selectedBodyPreset();
  const articulation = performanceState.articulation ?? {};
  const source = {
    ...resolveSourceControls(performanceState),
    outputGain: 0.82
      * (FAMILY_OUTPUT_TRIM[animal.model] ?? 0.82)
      * resolveSyrinxPresetGain(performanceState)
      * clamp(articulation.sourceGain ?? 1, 0, 1.5),
    voiceCount: 1,
    voiceSpreadCents: 0,
  };
  const tract = {
    animalId: animal.id,
    model: animal.model,
    tractLengthM: performanceState.tractLengthM,
    tractDiameterProfile: performanceState.tractDiameterProfile
      ?? state.tractDiameterProfile
      ?? body.tractDiameterProfile,
    tractDiameterScale: performanceState.tractDiameterScale
      ?? state.tractDiameterScale
      ?? body.tractDiameterScale,
    mouthOpening: performanceState.mouthOpening,
    cavityCoupling: performanceState.cavityCoupling,
    cavityFrequencyHz: performanceState.cavityFrequencyHz
      ?? state.cavityFrequencyHz
      ?? body.cavityFrequencyHz,
    cavityBranches: 2,
    airwayGate: clamp(articulation.airwayGate ?? 1),
    lateralBypass: 0,
    turbulence: clamp(
      performanceState.roughness * 0.16 + (articulation.turbulence ?? 0),
      0,
      1.5,
    ),
    articulationVoicing: clamp(articulation.voicing ?? 1),
    articulationPressure: performanceState.active
      ? performanceState.pressure * clamp(articulation.pressure ?? 1)
      : 0,
    burstGain: clamp(articulation.burstGain ?? 0, 0, 1.5),
    burstFrequencyHz: clamp(articulation.burstFrequencyHz ?? 1_050, 80, 12_000),
    flowDirection: Number(articulation.flowDirection) < 0 ? -1 : 1,
    flutterHz: Math.max(
      clamp(articulation.flutterHz ?? 0, 0, 60),
      modulationTarget === "beak" ? state.modulationRateHz : 0,
    ),
    flutterDepth: Math.max(
      clamp(articulation.flutterDepth ?? 0),
      modulationTarget === "beak" ? state.modulationDepth * 0.16 : 0,
    ),
    sourceBalance: performanceState.sourceBalance * 2 - 1,
    asymmetry: performanceState.asymmetry,
  };
  return Object.freeze({ source, tract, resetTract: false });
}

function restingConfiguration() {
  return physicalConfiguration(displayPerformanceState());
}

async function createAudioGraph() {
  const Context = globalThis.AudioContext ?? globalThis.webkitAudioContext;
  if (!Context) throw new Error("This browser does not provide Web Audio.");
  const context = new Context({ latencyHint: "interactive", sampleRate: 48_000 });
  unlockAudioContext(context);
  await context.audioWorklet.addModule(new URL(
    "./src/creaturazoid-processor.js?v=creaturazoid-worklet-20260902-4",
    import.meta.url,
  ));
  const configuration = restingConfiguration();
  const sourceNode = new AudioWorkletNode(context, "creaturazoid-physical-model", {
    numberOfInputs: 0,
    numberOfOutputs: 1,
    outputChannelCount: [2],
    channelCount: 2,
    channelCountMode: "explicit",
    processorOptions: {
      configuration: {
        source: configuration.source,
        tract: configuration.tract,
        seed: 0xc7ea7e,
      },
    },
  });
  const masterGain = context.createGain();
  const compressor = context.createDynamicsCompressor();
  const makeupGain = context.createGain();
  const analyser = context.createAnalyser();
  masterGain.gain.value = state.level;
  compressor.threshold.value = -18;
  compressor.knee.value = 18;
  compressor.ratio.value = 6;
  compressor.attack.value = 0.002;
  compressor.release.value = 0.16;
  makeupGain.gain.value = 1.12;
  analyser.fftSize = 1_024;
  analyser.smoothingTimeConstant = 0.7;
  sourceNode.connect(compressor);
  compressor.connect(makeupGain);
  makeupGain.connect(masterGain);
  masterGain.connect(analyser);
  const releaseOutput = connectAudioOutput(context, analyser, { runtime: globalThis });
  sourceNode.port.onmessage = (event) => {
    if (event.data?.type === "telemetry") telemetry = Object.freeze({ ...telemetry, ...event.data });
  };
  sourceNode.onprocessorerror = () => {
    stopSequence({ silence: false, announceState: false });
    setAudioPresentation("error", "The Creaturazoid physical model stopped. Reload the page to reset it.");
  };
  return { context, sourceNode, compressor, makeupGain, masterGain, analyser, releaseOutput };
}

async function ensureAudio() {
  if (startingAudio) return false;
  if (!graph) {
    startingAudio = true;
    setAudioPresentation("starting");
    try {
      graph = await createAudioGraph();
      audioContext = graph.context;
    } catch (error) {
      console.error(error);
      setAudioPresentation("error", error?.message || "Unable to start Creaturazoid audio.");
      startingAudio = false;
      return false;
    }
    startingAudio = false;
  }
  try {
    unlockAudioContext(audioContext);
    await audioContext.resume();
    setAudioPresentation("on");
    return true;
  } catch (error) {
    console.error(error);
    setAudioPresentation("error", error?.message || "Unable to resume Creaturazoid audio.");
    return false;
  }
}

function silencePhysicalModel() {
  if (!graph?.sourceNode) return;
  serialCounter += 1;
  const configuration = restingConfiguration();
  graph.sourceNode.port.postMessage({
    type: "silence",
    serial: serialCounter,
    source: configuration.source,
    tract: configuration.tract,
  });
}

function updateMasterLevel() {
  if (!graph?.masterGain || !audioContext) return;
  graph.masterGain.gain.setTargetAtTime(state.level, audioContext.currentTime, 0.025);
}

function previousStateAt(time) {
  const previous = previousScheduledEvent;
  if (!previous) return null;
  const phase = clamp((time - previous.time) / Math.max(0.001, previous.duration));
  return resolveCreaturazoidEventState(previous.sound.id, {
    state: previous.state,
    phase,
    elapsedSeconds: Math.max(0, time - previous.time),
    velocity: previous.velocity,
  });
}

function scheduleSound(soundOrId, velocity = 0.72, when = null, { visual = true } = {}) {
  if (!graph?.sourceNode || !audioContext) return null;
  const sound = typeof soundOrId === "string" ? creaturazoidSound(soundOrId) : soundOrId;
  const startTime = Math.max(
    audioContext.currentTime + 0.006,
    finiteOr(when, audioContext.currentTime + 0.02),
  );
  const duration = clamp(sound.durationMs / 1_000, 0.08, 3.2);
  const contourOffsets = creaturazoidContourOffsets(duration, state, sound);
  const serial = ++serialCounter;
  const stateSnapshot = sanitizeCreaturazoidState({ ...state, morphBias: { ...state.morphBias } }, state);
  const fromState = previousStateAt(startTime)
    ?? resolveCreaturazoidEventState(sound.id, {
      state: stateSnapshot,
      phase: 0,
      elapsedSeconds: 0,
      velocity: 0,
    });
  const events = [];

  for (let index = 0; index < contourOffsets.length; index += 1) {
    const offsetSeconds = contourOffsets[index];
    const phase = offsetSeconds / duration;
    const eventTime = startTime + offsetSeconds;
    let performanceState = resolveCreaturazoidEventState(sound.id, {
      state: stateSnapshot,
      phase,
      elapsedSeconds: offsetSeconds,
      velocity,
    });
    const morphProgress = creaturazoidQuickMorphProgress(
      offsetSeconds * 1_000,
      stateSnapshot.morphTimeMs,
    );
    if (morphProgress < 1) {
      const targetState = performanceState;
      performanceState = {
        ...interpolateCreaturazoidMorph(fromState, targetState, morphProgress, { curve: "linear" }),
        // The new breath and source identity land on the sequencer edge. Only
        // tract/timbral geometry glides from the displaced call, preventing a
        // slow cross-morph from swallowing otherwise crisp attacks.
        animalId: targetState.animalId,
        callId: targetState.callId,
        sourceModel: targetState.sourceModel,
        sourceFamily: targetState.sourceFamily,
        pressure: targetState.pressure,
        level: targetState.level,
        active: targetState.active,
        gesturePhase: targetState.gesturePhase,
        sourceFrequencyRatio: targetState.sourceFrequencyRatio,
        effectivePitchSemitones: targetState.effectivePitchSemitones,
        bodyMotion: targetState.bodyMotion,
        bodyPresetId: targetState.bodyPresetId,
        bodyScale: targetState.bodyScale,
        bodyRoundness: targetState.bodyRoundness,
        attackMs: targetState.attackMs,
        tractDiameterProfile: targetState.tractDiameterProfile,
        tractDiameterScale: targetState.tractDiameterScale,
        cavityFrequencyHz: targetState.cavityFrequencyHz,
        articulation: targetState.articulation,
        gestureType: targetState.gestureType,
      };
    }
    performanceState = applySelectedModulation(performanceState, offsetSeconds);
    if (index === contourOffsets.length - 1) {
      performanceState = { ...performanceState, active: false, pressure: 0 };
    }
    events.push({
      frame: Math.round(eventTime * audioContext.sampleRate),
      serial,
      begin: index === 0,
      soundId: sound.id,
      label: sound.label,
      velocity: clamp(velocity),
      contact: index === 0 && sound.articulation?.contact
        ? {
          ...sound.articulation.contact,
          soundId: sound.id,
          durationMs: sound.durationMs,
          bodyScale: stateSnapshot.bodyScale,
          bodyRoundness: stateSnapshot.bodyRoundness,
          tractLengthM: performanceState.tractLengthM,
          cavityFrequencyHz: performanceState.cavityFrequencyHz,
        }
        : null,
      configuration: physicalConfiguration(performanceState),
    });
  }

  graph.sourceNode.port.postMessage({ type: "schedule", events });
  previousScheduledEvent = Object.freeze({
    sound,
    time: startTime,
    duration,
    velocity: clamp(velocity),
    state: stateSnapshot,
    serial,
  });
  if (visual) {
    scheduledSteps.push(Object.freeze({
      time: startTime,
      step: null,
      sound,
      duration,
      velocity: clamp(velocity),
      serial,
    }));
    scheduledSteps.sort((left, right) => left.time - right.time);
  }
  return previousScheduledEvent;
}

function scheduleSequenceEvent(step, time) {
  const event = creaturazoidStepEvent(pattern, step);
  let scheduled = null;
  if (event) {
    scheduled = scheduleSound(event.sound, event.velocity, time, { visual: false });
  }
  scheduledSteps.push(Object.freeze({
    time: scheduled?.time ?? time,
    step,
    sound: event?.sound ?? null,
    duration: scheduled?.duration ?? 0,
    velocity: event?.velocity ?? 0,
    serial: scheduled?.serial ?? serialCounter,
  }));
}

function schedulerTick() {
  if (!sequenceRunning || !audioContext) return;
  if (audioContext.state !== "running") {
    // Transient OS/browser audio interruptions should not leave the transport
    // visually running with a permanently dead scheduler.
    schedulerTimer = globalThis.setTimeout(schedulerTick, 80);
    return;
  }
  // As in Hiccup Head, discard subdivisions stranded behind a UI-thread stall
  // instead of clamping a backlog of unrelated creatures into one audio block.
  const now = audioContext.currentTime;
  const recoveryFloor = now + 0.008;
  let recoveryGuard = 0;
  while (nextStepTime < now - 0.025 && recoveryGuard < CREATURAZOID_MAX_STEPS * 2) {
    nextStepTime += creaturazoidStepIntervalSeconds(state.tempo, state.swing, nextStepNumber);
    nextStepNumber += 1;
    recoveryGuard += 1;
  }
  if (nextStepTime < recoveryFloor) nextStepTime = recoveryFloor;
  const horizon = now + (compactMedia?.matches ? 0.3 : 0.22);
  let guard = 0;
  while (nextStepTime < horizon && guard < CREATURAZOID_MAX_STEPS * 2) {
    const step = nextStepNumber % pattern.length;
    scheduleSequenceEvent(step, nextStepTime);
    nextStepTime += creaturazoidStepIntervalSeconds(state.tempo, state.swing, nextStepNumber);
    nextStepNumber += 1;
    guard += 1;
  }
  schedulerTimer = globalThis.setTimeout(schedulerTick, compactMedia?.matches ? 24 : 16);
}

function resetSequenceSchedule({ startDelay = 0.055, silence = true } = {}) {
  if (schedulerTimer) globalThis.clearTimeout(schedulerTimer);
  schedulerTimer = 0;
  scheduledSteps = [];
  previousScheduledEvent = null;
  if (silence) silencePhysicalModel();
  if (!sequenceRunning || !audioContext) return;
  nextStepNumber = currentStep >= 0 ? currentStep + 1 : 0;
  nextStepTime = audioContext.currentTime + startDelay;
  schedulerTick();
}

async function startSequence({ restart = currentStep < 0 } = {}) {
  if (!(await ensureAudio())) return;
  if (sequenceRunning) return;
  sequenceRunning = true;
  document.body.classList.add("is-performing");
  if (restart) currentStep = -1;
  nextStepNumber = currentStep >= 0 ? currentStep + 1 : 0;
  nextStepTime = audioContext.currentTime + 0.055;
  scheduledSteps = [];
  previousScheduledEvent = null;
  setTransportPresentation();
  schedulerTick();
  announce(`Creature sequence running; ${pattern.length} steps, one call at a time`);
}

function stopSequence({ silence = true, announceState = true } = {}) {
  sequenceRunning = false;
  document.body.classList.remove("is-performing");
  document.body.classList.remove("is-sounding");
  if (schedulerTimer) globalThis.clearTimeout(schedulerTimer);
  schedulerTimer = 0;
  scheduledSteps = [];
  previousScheduledEvent = null;
  activeVisualEvent = null;
  currentStep = -1;
  if (silence) silencePhysicalModel();
  setTransportPresentation();
  updateGridPlayhead();
  if (announceState) announce("Creature sequence stopped; airway resting");
}

async function toggleSequence() {
  if (sequenceRunning) stopSequence();
  else await startSequence();
}

async function triggerSound(soundOrId, velocity = 0.9) {
  if (!(await ensureAudio())) return;
  const sound = typeof soundOrId === "string" ? creaturazoidSound(soundOrId) : soundOrId;
  if (sequenceRunning) {
    if (schedulerTimer) globalThis.clearTimeout(schedulerTimer);
    schedulerTimer = 0;
    scheduledSteps = [];
    previousScheduledEvent = null;
    silencePhysicalModel();
  }
  const event = scheduleSound(sound, velocity, audioContext.currentTime + 0.018);
  if (sequenceRunning) {
    nextStepNumber = currentStep >= 0 ? currentStep + 1 : 0;
    nextStepTime = audioContext.currentTime + 0.1;
    schedulerTick();
  }
  if (event) announce(`${sound.label}: ${sound.articulation?.mechanism ?? `${ANIMALS[sound.animalId].label} ${CALL_GESTURES[sound.callId].label}`}; one body`);
}

function retargetActiveSound() {
  updateMasterLevel();
  if (!graph?.sourceNode || !activeVisualEvent || !audioContext) return;
  const phase = clamp(
    (audioContext.currentTime - activeVisualEvent.time) / Math.max(0.001, activeVisualEvent.duration),
  );
  let performanceState = resolveCreaturazoidEventState(activeVisualEvent.sound.id, {
    state,
    phase,
    elapsedSeconds: Math.max(0, audioContext.currentTime - activeVisualEvent.time),
    velocity: activeVisualEvent.velocity,
  });
  performanceState = applySelectedModulation(
    performanceState,
    Math.max(0, audioContext.currentTime - activeVisualEvent.time),
  );
  const configuration = physicalConfiguration(performanceState);
  graph.sourceNode.port.postMessage({
    type: "retarget",
    serial: activeVisualEvent.serial,
    source: configuration.source,
    tract: configuration.tract,
  });
}

function consumeVisualSchedule() {
  if (!audioContext) return;
  const now = audioContext.currentTime;
  while (scheduledSteps.length && scheduledSteps[0].time <= now + 0.004) {
    const event = scheduledSteps.shift();
    if (event.step != null) {
      currentStep = event.step;
      setRhythmAccent(currentStep, event.velocity, event.sound);
      updateGridPlayhead();
    }
    if (event.sound) {
      activeVisualEvent = event;
      document.body.classList.add("is-sounding");
      setRhythmAccent(event.serial + 3, event.velocity, event.sound);
      setActivePad(event.sound.id);
    }
  }
  if (
    activeVisualEvent
    && now > activeVisualEvent.time + activeVisualEvent.duration + 0.04
  ) {
    activeVisualEvent = null;
    document.body.classList.remove("is-sounding");
    setActivePad("");
  }
}

function setTransportPresentation() {
  $("playButton").setAttribute("aria-pressed", String(sequenceRunning));
  $("playLabel").textContent = sequenceRunning ? "Stop" : "Play";
  $("playState").textContent = sequenceRunning
    ? `${currentStep < 0 ? "counting in" : `step ${currentStep + 1}`} · monophonic`
    : `space · ${pattern.length} steps`;
}

function setActivePad(soundId) {
  for (const button of $("padGrid").querySelectorAll("button[data-sound-id]")) {
    button.classList.toggle("is-active", button.dataset.soundId === soundId);
    button.setAttribute("aria-pressed", String(button.dataset.soundId === soundId));
  }
}

function buildPadGrid() {
  const fragment = document.createDocumentFragment();
  for (const sound of CREATURAZOID_SOUNDS) {
    const animal = ANIMALS[sound.animalId];
    const button = document.createElement("button");
    button.type = "button";
    button.dataset.soundId = sound.id;
    button.dataset.padIndex = String(fragment.childElementCount);
    button.dataset.gestureType = sound.gestureType;
    button.classList.toggle("is-percussive", sound.gestureType === "percussive");
    button.setAttribute("aria-pressed", "false");
    button.setAttribute("aria-label", `${sound.label}, ${sound.articulation?.mechanism ?? `${animal.label} ${CALL_GESTURES[sound.callId].label}`}, key ${sound.key}`);
    button.style.setProperty("--sound-color", sound.color);
    const label = document.createElement("b");
    label.textContent = sound.label;
    const detail = document.createElement("small");
    detail.textContent = `${sound.key.toUpperCase()} · ${sound.gestureType === "percussive" ? "BODY" : animal.label}`;
    button.append(label, detail);
    button.addEventListener("click", () => triggerSound(sound, 0.9));
    fragment.append(button);
  }
  $("padGrid").replaceChildren(fragment);
}

function updateGridPlayhead() {
  for (let row = 0; row < gridCells.length; row += 1) {
    for (let step = 0; step < gridCells[row].length; step += 1) {
      gridCells[row][step]?.classList.toggle("is-playhead", sequenceRunning && step === currentStep);
    }
  }
  setTransportPresentation();
}

function buildSequenceGrid({ preserveScroll = true } = {}) {
  const grid = $("sequenceGrid");
  const scroller = grid.parentElement;
  const scrollLeft = preserveScroll ? scroller.scrollLeft : 0;
  const scrollTop = preserveScroll ? scroller.scrollTop : 0;
  const fragment = document.createDocumentFragment();
  const sustainOwners = Array(pattern.length).fill(null);
  for (let onsetStep = 0; onsetStep < pattern.length; onsetStep += 1) {
    const onset = creaturazoidStepEvent(pattern, onsetStep);
    if (!onset) continue;
    const duration = onset.sound.durationMs / 1_000 || 0;
    let elapsed = 0;
    for (let step = onsetStep + 1; step < pattern.length; step += 1) {
      elapsed += creaturazoidStepIntervalSeconds(state.tempo, state.swing, step - 1);
      if (elapsed >= duration || creaturazoidStepEvent(pattern, step)) break;
      sustainOwners[step] = Object.freeze({
        soundId: onset.soundId,
        onsetStep,
      });
    }
  }
  gridCells = [];
  grid.style.setProperty("--sequence-steps", String(pattern.length));
  grid.setAttribute("aria-rowcount", String(CREATURAZOID_SOUNDS.length + 1));
  grid.setAttribute("aria-colcount", String(pattern.length + 1));

  const headerRow = document.createElement("div");
  headerRow.className = "creaturazoid-grid-row";
  headerRow.setAttribute("role", "row");
  const corner = document.createElement("span");
  corner.className = "creaturazoid-grid-corner";
  corner.setAttribute("role", "columnheader");
  corner.textContent = "CALL / STEP";
  headerRow.append(corner);
  for (let step = 0; step < pattern.length; step += 1) {
    const number = document.createElement("span");
    number.className = "creaturazoid-grid-number";
    number.setAttribute("role", "columnheader");
    number.textContent = String(step + 1);
    headerRow.append(number);
  }
  fragment.append(headerRow);

  CREATURAZOID_SOUNDS.forEach((sound, rowIndex) => {
    const animal = ANIMALS[sound.animalId];
    const rowCells = [];
    const row = document.createElement("div");
    row.className = "creaturazoid-grid-row";
    row.dataset.gestureType = sound.gestureType;
    row.classList.toggle("is-percussive", sound.gestureType === "percussive");
    row.setAttribute("role", "row");
    const rowHeader = document.createElement("div");
    rowHeader.className = "creaturazoid-grid-label";
    rowHeader.style.setProperty("--sound-color", sound.color);
    rowHeader.setAttribute("role", "rowheader");
    const label = document.createElement("button");
    label.type = "button";
    label.className = "creaturazoid-grid-label-action";
    label.setAttribute("aria-label", `Play ${sound.label}, ${sound.articulation?.mechanism ?? animal.label}`);
    const dot = document.createElement("i");
    dot.setAttribute("aria-hidden", "true");
    const name = document.createElement("span");
    name.textContent = sound.label;
    const key = document.createElement("small");
    key.textContent = sound.key.toUpperCase();
    label.append(dot, name, key);
    label.addEventListener("click", () => triggerSound(sound, 0.86));
    rowHeader.append(label);
    row.append(rowHeader);

    for (let step = 0; step < pattern.length; step += 1) {
      const velocity = pattern.rows[sound.id][step];
      const cell = document.createElement("button");
      cell.type = "button";
      cell.className = "creaturazoid-grid-cell";
      cell.dataset.soundId = sound.id;
      cell.dataset.step = String(step);
      cell.dataset.velocity = String(velocity);
      const level = Math.max(0, CREATURAZOID_DYNAMICS.findIndex((amount) => (
        Math.abs(amount - velocity) < 0.02
      )));
      cell.dataset.level = String(level);
      const sustain = velocity <= 0 && sustainOwners[step]?.soundId === sound.id;
      cell.classList.toggle("is-sustain", sustain);
      if (sustain) cell.dataset.sustainFrom = String(sustainOwners[step].onsetStep);
      cell.style.setProperty("--sound-color", sound.color);
      cell.style.setProperty("--row-color", sound.color);
      cell.setAttribute("role", "gridcell");
      cell.setAttribute("aria-selected", String(velocity > 0));
      cell.setAttribute(
        "aria-label",
        `${sound.label}, step ${step + 1}, ${velocity > 0
          ? `${Math.round(velocity * 100)} percent onset`
          : sustain
            ? `sustaining from step ${sustainOwners[step].onsetStep + 1}`
            : "off"}`,
      );
      cell.addEventListener("click", () => editSequenceCell(sound.id, step));
      rowCells.push(cell);
      row.append(cell);
    }
    fragment.append(row);
    gridCells[rowIndex] = rowCells;
  });

  grid.replaceChildren(fragment);
  requestAnimationFrame(() => {
    scroller.scrollLeft = scrollLeft;
    scroller.scrollTop = scrollTop;
  });
  updateGridPlayhead();
}

function editSequenceCell(soundId, step) {
  pattern = cycleCreaturazoidStep(pattern, step, soundId);
  currentPatternId = "custom";
  $("patternSelect").value = "custom";
  buildSequenceGrid();
  if (sequenceRunning) resetSequenceSchedule({ startDelay: 0.07 });
  const event = creaturazoidStepEvent(pattern, step);
  announce(event
    ? `${event.sound.label} set at step ${step + 1}, ${Math.round(event.velocity * 100)} percent; any previous call was replaced`
    : `Step ${step + 1} cleared`);
}

function populateSelects() {
  const presetSelect = $("presetSelect");
  presetSelect.replaceChildren(...CREATURAZOID_BODY_PRESETS.map((preset) => {
    const option = document.createElement("option");
    option.value = preset.id;
    option.textContent = preset.label;
    return option;
  }));

  const patternSelect = $("patternSelect");
  const custom = document.createElement("option");
  custom.value = "custom";
  custom.textContent = "Custom creature";
  patternSelect.append(custom, ...CREATURAZOID_SEQUENCE_PRESETS.map((preset) => {
    const option = document.createElement("option");
    option.value = preset.id;
    option.textContent = `${preset.label} · ${preset.length}`;
    return option;
  }));

  const anatomySelect = $("anatomySelect");
  anatomySelect.replaceChildren(...CREATURAZOID_ANATOMY_DESIGNS.map((anatomy) => {
    const option = document.createElement("option");
    option.value = anatomy.id;
    option.textContent = anatomy.label;
    option.title = anatomy.description;
    return option;
  }));
}

function setBodyPreset(id, { announceState = true, preserveSequence = true } = {}) {
  const preset = creaturazoidBodyPreset(id);
  const preserved = {
    level: state.level,
    tempo: state.tempo,
    swing: state.swing,
    patternLength: pattern.length,
    sequencePresetId: preserveSequence && currentPatternId !== "custom"
      ? currentPatternId
      : state.sequencePresetId,
  };
  state = creaturazoidState(preset.id, preserved);
  modulationTarget = preset.modulationTarget ?? "cavity";
  syncControls();
  retargetActiveSound();
  if (announceState) {
    announce(`${preset.label} body loaded; every call and rhythm now travels through this same shape`);
  }
}

function setAnatomyDesign(id, { announceState = true } = {}) {
  const anatomy = creaturazoidAnatomyDesign(id);
  state = sanitizeCreaturazoidState({ ...state, anatomyDesignId: anatomy.id }, state);
  $("anatomySelect").value = anatomy.id;
  drawCreature(audioContext?.currentTime ?? performance.now() / 1_000);
  if (announceState) announce(`${anatomy.label} selected; acoustic controls and the one airway remain shared`);
}

function setSequencePreset(id, { announceState = true } = {}) {
  const preset = creaturazoidSequencePreset(id);
  pattern = sanitizeCreaturazoidPattern(preset, preset.length);
  currentPatternId = preset.id;
  // A rhythm is only a rhythm. Changing it must never swap or reconstruct the
  // persistent body that every source is currently travelling through.
  state = sanitizeCreaturazoidState({
    ...state,
    tempo: preset.tempo,
    swing: preset.swing,
    patternLength: preset.length,
    sequencePresetId: preset.id,
  }, state);
  syncControls();
  buildSequenceGrid({ preserveScroll: false });
  if (sequenceRunning) resetSequenceSchedule({ startDelay: 0.07 });
  if (announceState) {
    announce(`${preset.label}: ${preset.length} steps; the current body shape remains locked`);
  }
}

function cyclePreset(collection, currentId, direction = 1) {
  const index = collection.findIndex(({ id }) => id === currentId);
  return collection[(index + direction + collection.length) % collection.length];
}

function randomizeCreature() {
  const randomSigned = () => Math.random() * 2 - 1;
  const morphBias = Object.fromEntries(Object.keys(state.morphBias).map((key) => [
    key,
    clamp(state.morphBias[key] + randomSigned() * 0.34, -1, 1),
  ]));
  const bodyState = { ...state.bodyState };
  for (const name of [
    "pressure", "tension", "adduction", "sourceScale", "mouthOpening",
    "cavityCoupling", "asymmetry", "sourceBalance", "roughness",
  ]) {
    const limits = CONTROL_LIMITS[name];
    bodyState[name] = clamp(
      finiteOr(bodyState[name], 0.5) + randomSigned() * (limits[1] - limits[0]) * 0.08,
      ...limits,
    );
  }
  bodyState.tractLengthM = clamp(
    finiteOr(bodyState.tractLengthM, 0.17) * (2 ** (randomSigned() * 0.24)),
    ...CONTROL_LIMITS.tractLengthM,
  );
  bodyState.tractDiameterScale = clamp(
    finiteOr(bodyState.tractDiameterScale, 1) * (2 ** (randomSigned() * 0.16)),
    0.25,
    4,
  );
  bodyState.cavityFrequencyHz = clamp(
    finiteOr(bodyState.cavityFrequencyHz, 500) * (2 ** (randomSigned() * 0.22)),
    40,
    8_000,
  );
  state = sanitizeCreaturazoidState({
    ...state,
    bodyPresetId: state.bodyPresetId,
    bodyScale: state.bodyScale * (2 ** (randomSigned() * 0.14)),
    bodyRoundness: state.bodyRoundness + randomSigned() * 0.24,
    attackMs: state.attackMs + randomSigned() * 8,
    morph: clamp(state.morph + randomSigned() * 0.22),
    pitchSemitones: state.pitchSemitones + Math.round(randomSigned() * 7),
    timbre: clamp(state.timbre + randomSigned() * 0.38, -1, 1),
    morphTimeMs: state.morphTimeMs + randomSigned() * 45,
    vibratoRateHz: state.vibratoRateHz + randomSigned() * 4,
    vibratoDepthSemitones: state.vibratoDepthSemitones + randomSigned() * 1.2,
    modulationRateHz: state.modulationRateHz + randomSigned() * 4,
    modulationDepth: state.modulationDepth + randomSigned() * 0.3,
    bodyState,
    morphBias,
  }, state);
  syncControls();
  retargetActiveSound();
  announce("Body mutated; its new dimensions, response, and motion stay locked while calls and sequence remain intact");
}

function scatterPattern() {
  let next = sanitizeCreaturazoidPattern({}, pattern.length);
  const dynamics = CREATURAZOID_DYNAMICS.slice(1);
  const percussion = CREATURAZOID_SOUNDS.filter(({ gestureType }) => gestureType === "percussive");
  const compactVoices = CREATURAZOID_SOUNDS.filter(({ gestureType, durationMs }) => (
    gestureType === "vocal" && durationMs <= 1_000
  ));
  const longVoices = CREATURAZOID_SOUNDS.filter(({ gestureType, durationMs }) => (
    gestureType === "vocal" && durationMs > 1_000
  ));
  const birds = CREATURAZOID_SOUNDS.filter(({ family }) => family === "bird");
  let step = Math.floor(Math.random() * 2);
  let lastSoundId = "";
  while (step < pattern.length) {
    const roll = Math.random();
    let pool = roll < 0.58
      ? percussion
      : roll < 0.78
        ? compactVoices
        : roll < 0.9
          ? birds
          : longVoices;
    if (pool.length > 1) pool = pool.filter(({ id }) => id !== lastSoundId);
    const sound = pool[Math.floor(Math.random() * pool.length)] ?? CREATURAZOID_SOUNDS[0];
    const velocity = dynamics[Math.floor(Math.random() * dynamics.length)];
    next = setCreaturazoidStep(next, step, sound.id, velocity);
    lastSoundId = sound.id;
    const nativeSpace = creaturazoidRecommendedSpaceSteps(sound, state.tempo);
    step += sound.gestureType === "percussive"
      ? 1 + Math.floor(Math.random() * 3)
      : sound.durationMs <= 1_000
        ? 2 + Math.floor(Math.random() * 4)
        : Math.max(6, Math.round(nativeSpace * (0.72 + Math.random() * 0.34)));
  }
  pattern = next;
  currentPatternId = "custom";
  $("patternSelect").value = "custom";
  buildSequenceGrid({ preserveScroll: false });
  if (sequenceRunning) resetSequenceSchedule({ startDelay: 0.07 });
  announce("Creature scatter: body percussion, bird cuts, and short calls interlock around breathing room for long voices");
}

function clearPattern() {
  pattern = sanitizeCreaturazoidPattern({}, pattern.length);
  currentPatternId = "custom";
  $("patternSelect").value = "custom";
  buildSequenceGrid();
  if (sequenceRunning) resetSequenceSchedule({ startDelay: 0.07 });
  announce("Sequence cleared to rests");
}

function setPatternLength(value) {
  const length = Math.round(clamp(value, ...CREATURAZOID_LIMITS.patternLength));
  if (length === pattern.length) return;
  pattern = sanitizeCreaturazoidPattern(pattern, length);
  state = sanitizeCreaturazoidState({ ...state, patternLength: length }, state);
  currentPatternId = "custom";
  syncControls();
  buildSequenceGrid({ preserveScroll: false });
  if (sequenceRunning) resetSequenceSchedule({ startDelay: 0.07 });
  announce(`Sequence length ${length}; one call maximum in every column`);
}

const CONTROL_BINDINGS = Object.freeze([
  {
    id: "bodyScale",
    output: "bodyScaleOut",
    read: () => state.bodyScale,
    write: (value) => { state = sanitizeCreaturazoidState({ ...state, bodyScale: value }, state); },
    format: formatPercent,
  },
  {
    id: "bodyRoundness",
    output: "bodyRoundnessOut",
    read: () => state.bodyRoundness,
    write: (value) => { state = sanitizeCreaturazoidState({ ...state, bodyRoundness: value }, state); },
    format: formatSigned,
  },
  {
    id: "pressure",
    output: "pressureOut",
    read: () => 1 + state.morphBias.pressure * 0.8,
    write: (value) => withMorphBias("pressure", (value - 1) / 0.8),
    format: (value) => formatPercent(value),
  },
  {
    id: "morph",
    output: "morphOut",
    read: () => state.morph,
    write: (value) => { state = sanitizeCreaturazoidState({ ...state, morph: value }, state); },
    format: formatPercent,
  },
  {
    id: "tension",
    output: "tensionOut",
    read: () => state.morphBias.tension,
    write: (value) => withMorphBias("tension", value),
    format: formatSigned,
  },
  {
    id: "pitch",
    output: "pitchOut",
    read: () => state.pitchSemitones,
    write: (value) => { state = sanitizeCreaturazoidState({ ...state, pitchSemitones: value }, state); },
    format: formatSemitones,
  },
  {
    id: "beak",
    output: "beakOut",
    read: () => state.morphBias.mouthOpening,
    write: (value) => withMorphBias("mouthOpening", value),
    format: formatSigned,
  },
  {
    id: "tract",
    output: "tractOut",
    read: () => 2 ** (state.morphBias.tractLengthM * 1.7),
    write: (value) => withMorphBias("tractLengthM", Math.log2(Math.max(0.01, value)) / 1.7),
    format: (value) => `${Math.round(value * 100)}%`,
  },
  {
    id: "cavity",
    output: "cavityOut",
    read: () => state.morphBias.cavityCoupling,
    write: (value) => withMorphBias("cavityCoupling", value),
    format: formatSigned,
  },
  {
    id: "roughness",
    output: "roughnessOut",
    read: () => state.morphBias.roughness,
    write: (value) => withMorphBias("roughness", value),
    format: formatSigned,
  },
  {
    id: "split",
    output: "splitOut",
    read: () => state.morphBias.asymmetry,
    write: (value) => withMorphBias("asymmetry", value),
    format: formatSigned,
  },
  {
    id: "balance",
    output: "balanceOut",
    read: () => state.morphBias.sourceBalance,
    write: (value) => withMorphBias("sourceBalance", value),
    format: formatSigned,
  },
  {
    id: "attackMs",
    output: "attackMsOut",
    read: () => state.attackMs,
    write: (value) => { state = sanitizeCreaturazoidState({ ...state, attackMs: value }, state); },
    format: (value) => `${Math.round(value)} ms`,
  },
  {
    id: "morphMs",
    output: "morphMsOut",
    read: () => state.morphTimeMs,
    write: (value) => { state = sanitizeCreaturazoidState({ ...state, morphTimeMs: value }, state); },
    format: (value) => `${Math.round(value)} ms`,
  },
  {
    id: "vibratoRate",
    output: "vibratoRateOut",
    read: () => state.vibratoRateHz,
    write: (value) => { state = sanitizeCreaturazoidState({ ...state, vibratoRateHz: value }, state); },
    format: (value) => `${value.toFixed(1)} Hz`,
  },
  {
    id: "vibratoDepth",
    output: "vibratoDepthOut",
    read: () => state.vibratoDepthSemitones,
    write: (value) => { state = sanitizeCreaturazoidState({ ...state, vibratoDepthSemitones: value }, state); },
    format: (value) => `${value.toFixed(2).replace(/0$/, "")} st`,
  },
  {
    id: "timbre",
    output: "timbreOut",
    read: () => state.timbre,
    write: (value) => { state = sanitizeCreaturazoidState({ ...state, timbre: value }, state); },
    format: formatSigned,
  },
  {
    id: "modulationRate",
    output: "modulationRateOut",
    read: () => state.modulationRateHz,
    write: (value) => { state = sanitizeCreaturazoidState({ ...state, modulationRateHz: value }, state); },
    format: (value) => `${value.toFixed(2).replace(/0$/, "")} Hz`,
  },
  {
    id: "modulationDepth",
    output: "modulationDepthOut",
    read: () => state.modulationDepth,
    write: (value) => { state = sanitizeCreaturazoidState({ ...state, modulationDepth: value }, state); },
    format: formatPercent,
  },
]);

function syncControls() {
  $("presetSelect").value = state.bodyPresetId;
  $("patternSelect").value = currentPatternId;
  const preset = selectedBodyPreset();
  $("presetDescription").textContent = preset.description;
  $("presetSelect").style.setProperty("--preset-color", preset.color);
  $("anatomySelect").value = state.anatomyDesignId;
  $("sequenceLength").value = String(pattern.length);
  outputStateValue($("sequenceLengthOut"), String(pattern.length));
  $("tempo").value = String(state.tempo);
  outputStateValue($("tempoOut"), `${Math.round(state.tempo)} BPM`);
  $("swing").value = String(state.swing);
  outputStateValue($("swingOut"), formatPercent(state.swing));
  $("level").value = String(state.level);
  outputStateValue($("levelOut"), formatPercent(state.level));
  $("modulationTarget").value = modulationTarget;
  $("modulationShape").value = state.modulationShape;
  for (const binding of CONTROL_BINDINGS) {
    const value = binding.read();
    const element = $(binding.id);
    if (element) element.value = String(value);
    outputStateValue($(binding.output), binding.format(value));
  }
  outputStateValue($("stageMorphReadout"), `${Math.round(state.morphTimeMs)} ms`);
  outputStateValue($("bodySizeReadout"), `${formatPercent(state.bodyScale)} · ${bodySizeLabel()}`);
  outputStateValue(
    $("bodyMotionReadout"),
    `${preset.modulations.length} envelopes · ${Math.round(state.attackMs)} ms attack`,
  );
  $("bodySummary").textContent = `${formatPercent(state.bodyScale)} body · ${formatSigned(state.bodyRoundness)} roundness · ${formatPercent(1 + state.morphBias.pressure * 0.8)} lungs`;
  $("cavitySummary").textContent = `${formatSigned(state.morphBias.cavityCoupling)} cavity · ${formatSigned(state.morphBias.roughness)} rough`;
  $("modulationSummary").textContent = `${preset.modulations.length} body envelopes · ${state.vibratoRateHz.toFixed(1)} Hz vibrato · ${modulationTarget} ${state.modulationShape}`;
  setTransportPresentation();
}

function bindControl(binding) {
  const element = $(binding.id);
  if (!element) return;
  element.addEventListener("input", () => {
    binding.write(finiteOr(element.value, binding.read()));
    outputStateValue($(binding.output), binding.format(binding.read()));
    syncControls();
    retargetActiveSound();
  });
}

function bodySizeLabel() {
  const scaleLabel = state.bodyScale <= 0.72
    ? "tiny"
    : state.bodyScale >= 1.18
      ? "huge"
      : state.bodyScale >= 1.04
        ? "large"
        : "middleweight";
  const shapeLabel = state.bodyRoundness >= 0.58
    ? "round"
    : state.bodyRoundness <= -0.32
      ? "narrow"
      : "balanced";
  return `${scaleLabel} · ${shapeLabel}`;
}

function bindControls() {
  CONTROL_BINDINGS.forEach(bindControl);
  $("level").addEventListener("input", () => {
    state = sanitizeCreaturazoidState({ ...state, level: finiteOr($("level").value, state.level) }, state);
    outputStateValue($("levelOut"), formatPercent(state.level));
    updateMasterLevel();
  });
  $("tempo").addEventListener("input", () => {
    state = sanitizeCreaturazoidState({ ...state, tempo: finiteOr($("tempo").value, state.tempo) }, state);
    outputStateValue($("tempoOut"), `${Math.round(state.tempo)} BPM`);
  });
  $("swing").addEventListener("input", () => {
    state = sanitizeCreaturazoidState({ ...state, swing: finiteOr($("swing").value, state.swing) }, state);
    outputStateValue($("swingOut"), formatPercent(state.swing));
  });
  $("modulationTarget").addEventListener("change", () => {
    modulationTarget = MODULATION_TARGETS[$("modulationTarget").value] ? $("modulationTarget").value : "cavity";
    syncControls();
    retargetActiveSound();
    announce(`Feather motion now shapes ${modulationTarget}`);
  });
  $("modulationShape").addEventListener("change", () => {
    state = sanitizeCreaturazoidState({ ...state, modulationShape: $("modulationShape").value }, state);
    syncControls();
    retargetActiveSound();
  });
  $("sequenceLength").addEventListener("input", () => outputStateValue(
    $("sequenceLengthOut"),
    String(Math.round(finiteOr($("sequenceLength").value, pattern.length))),
  ));
  $("sequenceLength").addEventListener("change", () => setPatternLength($("sequenceLength").value));
  document.querySelectorAll("[data-sequence-length]").forEach((button) => {
    button.addEventListener("click", () => setPatternLength(button.dataset.sequenceLength));
  });
  $("audioButton").addEventListener("click", async () => {
    if (audioContext?.state === "running" && $("audioButton").getAttribute("aria-pressed") === "true") {
      stopSequence({ announceState: false });
      await audioContext.suspend();
      setAudioPresentation("off");
      announce("Creaturazoid audio off");
      return;
    }
    if (await ensureAudio()) announce("Creaturazoid audio on; choose any call or run the sequence");
  });
  $("playButton").addEventListener("click", toggleSequence);
  $("restartButton").addEventListener("click", () => {
    currentStep = -1;
    if (sequenceRunning) resetSequenceSchedule({ startDelay: 0.055 });
    updateGridPlayhead();
    announce("Sequence returned to step one");
  });
  $("presetSelect").addEventListener("change", () => setBodyPreset($("presetSelect").value));
  $("anatomySelect").addEventListener("change", () => setAnatomyDesign($("anatomySelect").value));
  $("nextPresetButton").addEventListener("click", () => setBodyPreset(
    cyclePreset(CREATURAZOID_BODY_PRESETS, state.bodyPresetId).id,
  ));
  $("patternSelect").addEventListener("change", () => {
    if ($("patternSelect").value !== "custom") setSequencePreset($("patternSelect").value);
  });
  $("nextPatternButton").addEventListener("click", () => setSequencePreset(
    cyclePreset(CREATURAZOID_SEQUENCE_PRESETS, currentPatternId).id,
  ));
  $("randomizeButton").addEventListener("click", randomizeCreature);
  $("randomPatternButton").addEventListener("click", scatterPattern);
  $("clearPatternButton").addEventListener("click", clearPattern);
  $("resetButton").addEventListener("click", () => {
    stopSequence({ announceState: false });
    state = creaturazoidState();
    pattern = sanitizeCreaturazoidPattern(creaturazoidSequencePreset(state.sequencePresetId));
    currentPatternId = state.sequencePresetId;
    modulationTarget = selectedBodyPreset().modulationTarget ?? "cavity";
    syncControls();
    buildSequenceGrid({ preserveScroll: false });
    announce("Persistent body, call motion, and sequence restored");
  });
}

function resizeCanvas() {
  const bounds = stageWrap.getBoundingClientRect();
  const width = Math.max(1, Math.round(bounds.width));
  const height = Math.max(1, Math.round(bounds.height));
  const pixelBudget = compactMedia?.matches ? 950_000 : 2_400_000;
  const requestedDpr = Math.min(2, globalThis.devicePixelRatio || 1);
  const budgetDpr = Math.sqrt(pixelBudget / Math.max(1, width * height));
  const dpr = Math.max(1, Math.min(requestedDpr, budgetDpr));
  canvas.width = Math.max(1, Math.round(width * dpr));
  canvas.height = Math.max(1, Math.round(height * dpr));
  canvas.style.width = `${width}px`;
  canvas.style.height = `${height}px`;
  const scale = Math.max(80, Math.min(width * 0.37, height * 0.45));
  canvasMetrics = Object.freeze({
    width,
    height,
    dpr,
    cx: width * 0.5,
    cy: height * (width < 560 ? 0.51 : 0.53),
    scale,
  });
  // Paint synchronously after the canvas backing store changes. Some embedded
  // or backgrounded hosts throttle requestAnimationFrame until interaction;
  // the creature should still be present for the very first frame.
  drawCreature(audioContext?.currentTime ?? performance.now() / 1_000);
}

function stagePoint(nx, ny) {
  return {
    x: canvasMetrics.cx + nx * canvasMetrics.scale,
    y: canvasMetrics.cy + ny * canvasMetrics.scale,
  };
}

function persistentBodyTransform() {
  const size = clamp(finiteOr(state.bodyScale, 1), 0.55, 1.35);
  const roundness = clamp(finiteOr(state.bodyRoundness, 0), -1, 1);
  const visualSize = clamp(size, 0.66, 1.12);
  return Object.freeze({
    x: visualSize * (1 + roundness * 0.18),
    y: visualSize * (1 - roundness * 0.08),
  });
}

function bodyStagePoint(nx, ny) {
  const point = stagePoint(nx, ny);
  const transform = persistentBodyTransform();
  return {
    x: canvasMetrics.cx + (point.x - canvasMetrics.cx) * transform.x,
    y: canvasMetrics.cy + (point.y - canvasMetrics.cy) * transform.y,
  };
}

function pathFeather(context, baseX, baseY, tipX, tipY, width) {
  const dx = tipX - baseX;
  const dy = tipY - baseY;
  const length = Math.max(1, Math.hypot(dx, dy));
  const px = -dy / length * width;
  const py = dx / length * width;
  context.beginPath();
  context.moveTo(baseX, baseY);
  context.bezierCurveTo(
    baseX + dx * 0.28 + px,
    baseY + dy * 0.28 + py,
    tipX - dx * 0.22 + px * 0.55,
    tipY - dy * 0.22 + py * 0.55,
    tipX,
    tipY,
  );
  context.bezierCurveTo(
    tipX - dx * 0.22 - px * 0.55,
    tipY - dy * 0.22 - py * 0.55,
    baseX + dx * 0.28 - px,
    baseY + dy * 0.28 - py,
    baseX,
    baseY,
  );
  context.closePath();
}

function drawBackdrop(context, timeSeconds, palette) {
  const { width, height } = canvasMetrics;
  context.fillStyle = "#efdfb9";
  context.fillRect(0, 0, width, height);
  const spacing = Math.max(32, Math.min(58, width / 16));
  context.lineWidth = 1;
  context.strokeStyle = "rgba(23, 20, 15, 0.085)";
  for (let x = spacing * 0.5; x < width; x += spacing) {
    context.beginPath();
    context.moveTo(x, 0);
    context.lineTo(x, height);
    context.stroke();
  }
  for (let y = spacing * 0.5; y < height; y += spacing) {
    context.beginPath();
    context.moveTo(0, y);
    context.lineTo(width, y);
    context.stroke();
  }
  const orbit = Math.min(width, height) * 0.035;
  for (let index = 0; index < 8; index += 1) {
    const side = index % 2 ? 1 : -1;
    const x = side < 0 ? width * 0.08 : width * 0.92;
    const y = height * (0.2 + (index % 4) * 0.18);
    context.save();
    context.translate(x, y);
    context.rotate(side * (0.32 + Math.sin(timeSeconds * 0.25 + index) * 0.03));
    context.fillStyle = `${palette[(index + 2) % palette.length]}33`;
    pathFeather(context, 0, orbit * 0.55, side * orbit * 0.25, -orbit * 1.1, orbit * 0.38);
    context.fill();
    context.restore();
  }
}

function familyPose(sound, timeSeconds, performanceState) {
  const family = sound?.family ?? "mammal";
  const visual = sound ? activeVisualEvent : null;
  const phase = visual
    ? clamp((timeSeconds - visual.time) / Math.max(0.001, visual.duration))
    : 1;
  const velocity = visual ? clamp(visual.velocity) : 0;
  const active = Boolean(visual && phase < 1 && performanceState?.active !== false);
  const elapsed = visual ? Math.max(0, timeSeconds - visual.time) : 0;
  const durationMs = sound?.durationMs ?? 1_000;
  const pulseHz = durationMs < 420
    ? 13
    : family === "bird"
      ? 9.5
      : family === "rodent"
        ? 15
        : family === "frog"
          ? 4.2
          : 5.4;
  const attack = clamp(0.24 + phase / 0.045);
  const release = clamp((1 - phase) / Math.min(0.3, 160 / Math.max(160, durationMs)));
  const envelope = active ? Math.pow(attack * release, 0.42) : 0;
  const authoredEnvelope = active
    ? clamp(finiteOr(performanceState?.bodyMotion?.envelope, envelope))
    : 0;
  const bodyModulators = performanceState?.bodyMotion?.modulators ?? [];
  const bodyTremor = bodyModulators.length > 0
    ? bodyModulators.reduce((sum, motion) => (
      sum + finiteOr(motion.wave) * finiteOr(motion.depth)
    ), 0) / bodyModulators.length
    : 0;
  const contourEnvelope = Math.max(envelope * 0.5, authoredEnvelope);
  const onset = active ? Math.exp(-phase * (durationMs < 420 ? 8 : 15)) : 0;
  const oscillation = active && !prefersReducedMotion
    ? Math.sin(elapsed * Math.PI * 2 * pulseHz) * contourEnvelope + bodyTremor * 0.62
    : 0;
  const doublePulse = active && !prefersReducedMotion
    ? Math.sin(elapsed * Math.PI * 2 * pulseHz * 0.53 + 0.8) * contourEnvelope
    : 0;
  const pressure = active
    ? clamp(Math.max(finiteOr(performanceState?.pressure), finiteOr(telemetry.pressure) * 1.4))
    : clamp(finiteOr(telemetry.pressure) * 0.3);
  const motion = sound?.articulation?.motion ?? "vocal";
  const actionCycle = active && !prefersReducedMotion
    ? Math.max(0, Math.cos(phase * Math.PI * 8)) ** 6
    : 0;
  const irregularCycle = active && !prefersReducedMotion
    ? Math.max(0, Math.sin(phase * Math.PI * 7 + 0.4)) ** 4
    : 0;
  const landing = active
    ? Math.exp(-(((phase - 0.8) / 0.055) ** 2)) * velocity
    : 0;
  const bodyOnly = ["stomp", "footsteps", "jump", "claw", "whip", "ruffle"].includes(motion);
  const jawSnap = active
    ? clamp(
      (motion === "bark" || motion === "caw" ? onset : 0)
      + (motion === "crunch" ? actionCycle : 0)
      + (motion === "lap" ? actionCycle * 0.24 : 0),
    )
    : 0;
  const tongueFlick = active
    ? clamp((motion === "lap" ? actionCycle : 0) + (motion === "pant" ? actionCycle * 0.58 : 0))
    : 0;
  const featherRuffle = active && motion === "ruffle"
    ? clamp(0.36 + irregularCycle * 0.94)
    : 0;
  const clawSwipe = active && motion === "claw" ? irregularCycle * velocity : 0;
  const tailSweep = active && motion === "whip" ? Math.sin(Math.PI * phase) * velocity : 0;
  const footStrike = active
    ? (motion === "stomp"
      ? onset
      : motion === "footsteps"
        ? actionCycle
        : motion === "jump"
          ? Math.max(onset * 0.4, landing)
          : 0)
    : 0;
  const bodyDrop = footStrike * (motion === "jump" ? 0.075 : 0.105) * velocity;
  const actionLift = active && motion === "jump" && !prefersReducedMotion
    ? Math.sin(Math.PI * clamp(phase / 0.8)) * 0.16 * velocity
    : 0;
  const nostrilFlare = active && ["hiss", "neigh", "horn", "pant"].includes(motion)
    ? clamp(contourEnvelope * 0.72 + onset * 0.42)
    : 0;
  const headBob = active
    ? (motion === "lap" || motion === "pant" ? actionCycle * 0.055 : motion === "crunch" ? irregularCycle * 0.035 : 0)
    : 0;
  const hornKick = active && (motion === "horn" || motion === "neigh")
    ? clamp(onset * 0.9 + contourEnvelope * 0.24)
    : 0;
  const bird = family === "bird" ? 1 : 0;
  const mammal = family === "mammal" ? 1 : 0;
  const frog = family === "frog" ? 1 : 0;
  const rodent = family === "rodent" ? 1 : 0;
  const drive = active
    ? clamp(contourEnvelope * (0.46 + velocity * 0.76) + onset * velocity * 0.35)
    : 0;
  const articulatedMouth = clamp((finiteOr(performanceState?.mouthOpening) - 0.08) / 0.92);
  const mouthOpen = active
    ? clamp(Math.max(
      articulatedMouth * (0.42 + contourEnvelope * 0.7) * (bodyOnly ? 0.12 : 1),
      (0.16 + drive * (0.72 + bird * 0.22) + Math.abs(oscillation) * 0.13) * (bodyOnly ? 0.12 : 1),
      jawSnap * 0.88 + tongueFlick * 0.44 + (motion === "hiss" ? 0.28 : 0),
    ), 0, 1.35)
    : 0;
  const eyeBurst = active ? clamp(onset * 0.72 + drive * (0.26 + velocity * 0.34)) : 0;
  const neckStretch = active
    ? (0.055 + bird * 0.17 + mammal * 0.075 + rodent * 0.045 + frog * 0.03)
      * (0.52 + velocity * 0.72)
      * (0.58 + envelope * 0.42)
    : 0;
  const jump = active && !prefersReducedMotion
    ? velocity * (onset * 0.105 + Math.sin(Math.PI * phase) * 0.035) + actionLift - bodyDrop
    : 0;

  return Object.freeze({
    family,
    phase,
    active,
    velocity,
    envelope: contourEnvelope,
    onset,
    pressure,
    drive,
    mouthOpen,
    eyeBurst,
    neckStretch,
    neckWobble: oscillation * (0.012 + bird * 0.022 + velocity * 0.012),
    throatPulse: drive * 0.68 + Math.abs(oscillation) * 0.32,
    breath: clamp(pressure * 0.68 + drive * 0.5 + frog * envelope * 0.18),
    wingFlap: clamp(drive * (0.34 + bird * 0.8) + onset * velocity * 0.36 + oscillation * 0.15, -0.2, 1.5),
    cheekPulse: drive * 0.34 + Math.abs(doublePulse) * (0.1 + frog * 0.25),
    projection: drive * velocity,
    jump,
    motion,
    jawSnap,
    tongueFlick,
    nostrilFlare,
    hornKick,
    featherRuffle,
    bodyDrop,
    tailSweep,
    clawSwipe,
    footStrike,
    headBob,
    pulse: oscillation,
    secondPulse: doublePulse,
    bodyTremor,
    beakMorph: bird * clamp(drive * 1.18 + onset * 0.25 + (motion === "caw" ? 0.34 : 0)),
    bird,
    mammal,
    frog,
    rodent,
    colorBeat: visual
      ? visual.serial * 3 + (prefersReducedMotion ? 0 : Math.floor(phase * (durationMs < 420 ? 2 : 5)))
      : 0,
  });
}

const SPECIMEN_OPACITY = Object.freeze({
  shellIdle: 0.16,
  shellActive: 0.34,
  tissueIdle: 0.22,
  tissueActive: 0.46,
  organIdle: 0.32,
  organActive: 0.58,
  appendageIdle: 0.28,
  appendageActive: 0.52,
});

function specimenColorWithAlpha(color, opacity) {
  const source = String(color ?? "#ffffff");
  if (!/^#[0-9a-f]{6}$/i.test(source)) return source;
  const alpha = Math.round(clamp(opacity) * 255).toString(16).padStart(2, "0");
  return `${source}${alpha}`;
}

function specimenFillColor(color, pose, idleOpacity, activeOpacity) {
  return specimenColorWithAlpha(color, pose.active ? activeOpacity : idleOpacity);
}

function specimenOutlineWidth(scale, weight = 1) {
  return Math.max(2, scale * 0.01 * weight);
}

function brightenSpecimenColor(color, amount) {
  const source = String(color ?? "#ffffff");
  if (!/^#[0-9a-f]{6}$/i.test(source)) return source;
  const gain = 1 + clamp(amount, 0, 0.4);
  const channels = [1, 3, 5].map((offset) => (
    Math.min(255, Math.round(Number.parseInt(source.slice(offset, offset + 2), 16) * gain))
  ));
  return `#${channels.map((channel) => channel.toString(16).padStart(2, "0")).join("")}`;
}

function rhythmicPalette(palette, pose) {
  const rotation = pose.active ? Math.abs(pose.colorBeat) % palette.length : 0;
  const brightness = pose.active ? 0.16 + pose.velocity * 0.12 : 0.08;
  return Object.freeze(palette.map((_, index) => (
    brightenSpecimenColor(palette[(index + rotation) % palette.length], brightness)
  )));
}

function drawFeatherDisplay(context, timeSeconds, palette, pose) {
  const { cx, cy, scale } = canvasMetrics;
  const modulationWave = sampleModulationWave(
    state.modulationShape,
    timeSeconds * state.modulationRateHz,
    29,
  );
  const fan = 0.88 + state.modulationDepth * 0.32 + modulationWave * state.modulationDepth * 0.06;

  for (let index = 0; index < 15; index += 1) {
    const unit = index / 14;
    const angle = Math.PI + unit * Math.PI;
    const sideBias = Math.abs(unit - 0.5) * 2;
    const radius = scale * (0.86 + sideBias * 0.2 + pose.bird * 0.08) * fan;
    const baseX = cx + Math.cos(angle) * scale * 0.55;
    const baseY = cy + Math.sin(angle) * scale * 0.52 - scale * 0.08;
    const tipX = cx + Math.cos(angle) * radius;
    const tipY = cy + Math.sin(angle) * radius - scale * 0.08;
    context.fillStyle = palette[index % palette.length];
    context.strokeStyle = "#17140f";
    context.lineWidth = Math.max(1.5, scale * 0.011);
    pathFeather(context, baseX, baseY, tipX, tipY, scale * (0.1 + (1 - sideBias) * 0.025));
    context.fill();
    context.stroke();
    context.beginPath();
    context.moveTo(baseX, baseY);
    context.lineTo(tipX, tipY);
    context.strokeStyle = "rgba(255,255,255,0.48)";
    context.lineWidth = Math.max(1, scale * 0.006);
    context.stroke();
  }

  for (const side of [-1, 1]) {
    for (let index = 0; index < 5; index += 1) {
      const wave = Math.sin(timeSeconds * state.modulationRateHz * 0.8 + index * 0.8 + side) * state.modulationDepth;
      const base = stagePoint(side * 0.54, -0.02 + index * 0.13);
      const tip = stagePoint(
        side * (0.88 + index * 0.045 + wave * 0.06),
        -0.2 + index * 0.16 + wave * 0.035,
      );
      context.fillStyle = palette[(index + (side > 0 ? 2 : 5)) % palette.length];
      context.strokeStyle = "#17140f";
      context.lineWidth = Math.max(1.5, scale * 0.01);
      pathFeather(context, base.x, base.y, tip.x, tip.y, scale * 0.09);
      context.fill();
      context.stroke();
    }
  }
}

function drawLungs(context, palette, pose) {
  const { scale } = canvasMetrics;
  const pressure = clamp(0.56 + state.morphBias.pressure * 0.18 + telemetry.pressure * 0.16, 0.35, 0.92);
  for (const side of [-1, 1]) {
    const center = stagePoint(side * 0.27, 0.66);
    context.save();
    context.translate(center.x, center.y);
    context.rotate(side * -0.16);
    context.beginPath();
    context.ellipse(0, 0, scale * (0.2 + pressure * 0.06), scale * (0.27 + pressure * 0.06), 0, 0, Math.PI * 2);
    context.fillStyle = side < 0 ? palette[2] : palette[5];
    context.strokeStyle = "#17140f";
    context.lineWidth = Math.max(2, scale * 0.014);
    context.fill();
    context.stroke();
    context.beginPath();
    context.moveTo(0, -scale * 0.23);
    context.bezierCurveTo(side * scale * 0.05, -scale * 0.08, side * scale * 0.05, scale * 0.08, 0, scale * 0.22);
    context.strokeStyle = "rgba(255,255,255,0.65)";
    context.lineWidth = Math.max(2, scale * 0.012);
    context.stroke();
    context.restore();
  }
  const windpipe = stagePoint(0, 0.32);
  context.beginPath();
  context.moveTo(windpipe.x, windpipe.y);
  context.lineTo(windpipe.x, windpipe.y + scale * 0.38);
  context.strokeStyle = palette[0];
  context.lineWidth = scale * 0.07;
  context.stroke();
  context.strokeStyle = "#17140f";
  context.lineWidth = scale * 0.085;
  context.globalCompositeOperation = "destination-over";
  context.stroke();
  context.globalCompositeOperation = "source-over";
}

function drawHead(context, timeSeconds, palette, pose) {
  const { cx, cy, scale } = canvasMetrics;
  const cheek = clamp(1 + state.morphBias.cavityCoupling * 0.18 + pose.frog * 0.12 + pose.pulse * 0.018, 0.78, 1.35);
  const rough = clamp(0.5 + state.morphBias.roughness * 0.35, 0, 1);
  const browLift = Math.sin(timeSeconds * state.vibratoRateHz * Math.PI * 2) * state.vibratoDepthSemitones * 0.008;

  context.beginPath();
  context.moveTo(cx, cy - scale * 0.68);
  context.bezierCurveTo(cx - scale * 0.5, cy - scale * 0.72, cx - scale * 0.57 * cheek, cy - scale * 0.12, cx - scale * 0.48 * cheek, cy + scale * 0.28);
  context.bezierCurveTo(cx - scale * 0.38, cy + scale * 0.62, cx - scale * 0.18, cy + scale * 0.7, cx, cy + scale * 0.62);
  context.bezierCurveTo(cx + scale * 0.18, cy + scale * 0.7, cx + scale * 0.38, cy + scale * 0.62, cx + scale * 0.48 * cheek, cy + scale * 0.28);
  context.bezierCurveTo(cx + scale * 0.57 * cheek, cy - scale * 0.12, cx + scale * 0.5, cy - scale * 0.72, cx, cy - scale * 0.68);
  context.closePath();
  context.fillStyle = palette[1];
  context.strokeStyle = "#17140f";
  context.lineWidth = Math.max(3, scale * 0.022);
  context.fill();
  context.stroke();

  context.save();
  context.clip();
  context.globalAlpha = 0.52;
  for (let index = -5; index <= 5; index += 1) {
    const x = cx + index * scale * 0.105;
    context.beginPath();
    context.moveTo(x, cy - scale * 0.67);
    context.quadraticCurveTo(x + scale * 0.08, cy - scale * 0.18, x - scale * 0.02, cy + scale * 0.6);
    context.strokeStyle = palette[(index + 21) % palette.length];
    context.lineWidth = scale * 0.055;
    context.stroke();
  }
  context.restore();

  // Owl-like eye plates keep the face unmistakably forward-facing.
  for (const side of [-1, 1]) {
    const eye = stagePoint(side * 0.25, -0.27 + browLift);
    context.beginPath();
    context.ellipse(eye.x, eye.y, scale * 0.185, scale * 0.15, side * 0.09, 0, Math.PI * 2);
    context.fillStyle = "#fff4c9";
    context.strokeStyle = "#17140f";
    context.lineWidth = scale * 0.018;
    context.fill();
    context.stroke();
    const pupilShift = state.morphBias.sourceBalance * scale * 0.025;
    context.beginPath();
    context.ellipse(eye.x + pupilShift, eye.y, scale * (0.052 + pose.rodent * 0.018), scale * 0.082, 0, 0, Math.PI * 2);
    context.fillStyle = palette[4];
    context.fill();
    context.stroke();
    context.beginPath();
    context.arc(eye.x + pupilShift - scale * 0.016, eye.y - scale * 0.028, scale * 0.015, 0, Math.PI * 2);
    context.fillStyle = "#fff";
    context.fill();
  }

  // Thick expressive brows visibly carry vibrato.
  for (const side of [-1, 1]) {
    const brow = stagePoint(side * 0.25, -0.45 + browLift * (side < 0 ? 1 : -1));
    context.beginPath();
    context.moveTo(brow.x - side * scale * 0.14, brow.y + scale * 0.025);
    context.quadraticCurveTo(brow.x, brow.y - scale * (0.075 + state.vibratoDepthSemitones * 0.008), brow.x + side * scale * 0.14, brow.y + scale * 0.01);
    context.strokeStyle = "#17140f";
    context.lineWidth = scale * (0.035 + rough * 0.012);
    context.lineCap = "round";
    context.stroke();
  }

  // Two opaque cheek sacs are independent visual organs around one tract.
  for (const side of [-1, 1]) {
    const cheekCenter = stagePoint(side * 0.36, 0.08);
    context.beginPath();
    context.ellipse(
      cheekCenter.x,
      cheekCenter.y,
      scale * (0.16 + cheek * 0.025),
      scale * (0.13 + pose.frog * 0.04),
      side * 0.08,
      0,
      Math.PI * 2,
    );
    context.fillStyle = side < 0 ? palette[5] : palette[2];
    context.strokeStyle = "#17140f";
    context.lineWidth = scale * 0.015;
    context.fill();
    context.stroke();
    context.beginPath();
    context.arc(cheekCenter.x, cheekCenter.y, scale * 0.065, 0, Math.PI * 2);
    context.strokeStyle = "rgba(255,255,255,0.62)";
    context.lineWidth = scale * 0.012;
    context.stroke();
  }
}

function drawBeakAndThroat(context, timeSeconds, palette, pose) {
  const { cx, cy, scale } = canvasMetrics;
  const opening = clamp(0.28 + state.morphBias.mouthOpening * 0.16 + pose.pulse * 0.018, 0.1, 0.52);
  const billWidth = scale * (0.34 + pose.bird * 0.08 + pose.rodent * -0.06);
  const billTop = cy - scale * 0.1;
  const billTip = cy + scale * (0.2 + opening * 0.18);
  const throatSize = clamp(0.18 + pose.frog * 0.12 + state.morphBias.tractLengthM * 0.055, 0.12, 0.34);

  const throat = stagePoint(0, 0.43);
  context.beginPath();
  context.ellipse(throat.x, throat.y, scale * (0.21 + pose.frog * 0.08), scale * throatSize, 0, 0, Math.PI * 2);
  context.fillStyle = palette[6];
  context.strokeStyle = "#17140f";
  context.lineWidth = scale * 0.018;
  context.fill();
  context.stroke();
  context.beginPath();
  context.arc(throat.x, throat.y + scale * 0.02, scale * 0.11, 0.18 * Math.PI, 0.82 * Math.PI);
  context.strokeStyle = "rgba(255,255,255,0.55)";
  context.lineWidth = scale * 0.012;
  context.stroke();

  context.beginPath();
  context.moveTo(cx - billWidth, billTop);
  context.quadraticCurveTo(cx, cy - scale * 0.28, cx + billWidth, billTop);
  context.quadraticCurveTo(cx + scale * 0.18, cy + scale * 0.04, cx, billTip);
  context.quadraticCurveTo(cx - scale * 0.18, cy + scale * 0.04, cx - billWidth, billTop);
  context.closePath();
  context.fillStyle = palette[0];
  context.strokeStyle = "#17140f";
  context.lineWidth = scale * 0.022;
  context.fill();
  context.stroke();

  const mouthY = cy + scale * (0.075 + opening * 0.12);
  context.beginPath();
  context.moveTo(cx - billWidth * 0.72, mouthY);
  context.quadraticCurveTo(cx, mouthY + scale * (0.15 + opening * 0.12), cx + billWidth * 0.72, mouthY);
  context.quadraticCurveTo(cx, mouthY + scale * 0.08, cx - billWidth * 0.72, mouthY);
  context.closePath();
  context.fillStyle = "#25131d";
  context.fill();
  context.stroke();

  const toothCount = 8;
  for (let index = 0; index < toothCount; index += 1) {
    const unit = (index + 0.5) / toothCount;
    const x = cx - billWidth * 0.61 + unit * billWidth * 1.22;
    const toothWidth = billWidth * 0.11;
    const toothHeight = scale * (0.07 + (index % 3) * 0.012 + pose.mammal * 0.025);
    context.beginPath();
    context.moveTo(x - toothWidth * 0.5, mouthY + scale * 0.008);
    context.lineTo(x + toothWidth * 0.5, mouthY + scale * 0.008);
    context.lineTo(x + (index % 2 ? 1 : -1) * toothWidth * 0.1, mouthY + toothHeight);
    context.closePath();
    context.fillStyle = "#fff7d8";
    context.strokeStyle = "#17140f";
    context.lineWidth = Math.max(1, scale * 0.007);
    context.fill();
    context.stroke();
  }

  for (const side of [-1, 1]) {
    const nostril = stagePoint(side * (0.11 + state.morphBias.sourceBalance * 0.018), -0.045);
    context.beginPath();
    context.ellipse(nostril.x, nostril.y, scale * 0.052, scale * 0.034, side * 0.18, 0, Math.PI * 2);
    context.fillStyle = "#17140f";
    context.fill();
    context.beginPath();
    context.ellipse(nostril.x - side * scale * 0.012, nostril.y - scale * 0.009, scale * 0.012, scale * 0.008, 0, 0, Math.PI * 2);
    context.fillStyle = palette[3];
    context.fill();
  }
}

function controlHandlePositions(timeSeconds = 0) {
  const vibrato = prefersReducedMotion
    ? 0
    : Math.sin(timeSeconds * state.vibratoRateHz * Math.PI * 2);
  const feather = prefersReducedMotion
    ? 0
    : sampleModulationWave(state.modulationShape, timeSeconds * state.modulationRateHz, 29);
  const anatomy = activeAnatomyDesign();
  const wingY = anatomy.wingLift + anatomy.wingDrop + feather * state.modulationDepth * 0.035;
  return [
    { id: "pressure", label: "P", ...bodyStagePoint(-anatomy.thoraxWidth * 0.42, 0.62) },
    { id: "tension", label: "T", ...bodyStagePoint(0, 0.27) },
    { id: "beak", label: "B", ...bodyStagePoint(0, 0.08) },
    { id: "tract", label: "L", ...bodyStagePoint(0, 0.47) },
    { id: "cavity", label: "C", ...bodyStagePoint(-anatomy.skullWidth * 0.72, 0.01) },
    { id: "roughness", label: "R", ...bodyStagePoint(anatomy.skullWidth * 0.72, 0.01) },
    { id: "morphMs", label: "M", ...bodyStagePoint(0, 0.76) },
    { id: "vibratoRate", label: "VR", ...bodyStagePoint(-anatomy.wingSpan - vibrato * 0.018, wingY) },
    { id: "vibratoDepth", label: "VD", ...bodyStagePoint(anatomy.wingSpan + vibrato * 0.018, wingY) },
    { id: "modulationRate", label: "MR", ...bodyStagePoint(-anatomy.wingSpan * 0.6, anatomy.wingLift + feather * 0.025) },
    { id: "modulationDepth", label: "MD", ...bodyStagePoint(anatomy.wingSpan * 0.6, anatomy.wingLift - feather * 0.025) },
  ];
}

function drawControlHandles(context, timeSeconds, palette) {
  const radius = clamp(canvasMetrics.scale * 0.035, 8, 14);
  for (const [index, handle] of controlHandlePositions(timeSeconds).entries()) {
    context.save();
    context.translate(handle.x, handle.y);
    context.rotate(index % 2 ? Math.PI * 0.25 : 0);
    context.beginPath();
    context.roundRect(-radius, -radius, radius * 2, radius * 2, radius * 0.38);
    context.fillStyle = pointerDrag?.id === handle.id ? "#fff7dd" : palette[(index + 3) % palette.length];
    context.strokeStyle = "#17140f";
    context.lineWidth = Math.max(2, radius * 0.2);
    context.fill();
    context.stroke();
    context.restore();
    if (canvasMetrics.scale >= 150) {
      context.font = `900 ${Math.max(7, radius * 0.57)}px ui-sans-serif, system-ui, sans-serif`;
      context.textAlign = "center";
      context.textBaseline = "top";
      context.fillStyle = "#17140f";
      context.fillText(handle.label, handle.x, handle.y + radius + 3);
    }
  }
}

function soundSpotPoints() {
  return CREATURAZOID_SOUNDS.map((sound, index) => ({
    sound,
    ...stagePoint(...SOUND_SPOT_POSITIONS[index]),
  }));
}

function drawSoundSpots(context, timeSeconds) {
  const baseRadius = clamp(canvasMetrics.scale * 0.043, 9, 16);
  const activeId = displaySound()?.id;
  for (const { sound, x, y } of soundSpotPoints()) {
    const active = sound.id === activeId;
    const pulse = active ? 1 + Math.sin(timeSeconds * 15) * 0.12 : 1;
    const radius = baseRadius * pulse;
    context.beginPath();
    context.arc(x, y, radius + (active ? 4 : 2), 0, Math.PI * 2);
    context.fillStyle = "#fff7dd";
    context.fill();
    context.beginPath();
    context.arc(x, y, radius, 0, Math.PI * 2);
    context.fillStyle = sound.color;
    context.strokeStyle = "#17140f";
    context.lineWidth = Math.max(2, radius * 0.17);
    context.fill();
    context.stroke();
    context.font = `950 ${Math.max(7, radius * 0.72)}px ui-sans-serif, system-ui, sans-serif`;
    context.textAlign = "center";
    context.textBaseline = "middle";
    context.fillStyle = ["croak", "rattle"].includes(sound.id) ? "#fff" : "#17140f";
    context.fillText(sound.key.toUpperCase(), x, y + 0.5);
  }
}

function activeAnatomyDesign() {
  const anatomy = ANATOMY_DESIGNS.find(({ id }) => id === state.anatomyDesignId) ?? ANATOMY_DESIGNS[0];
  const shape = state.bodyShape ?? selectedBodyPreset().shape;
  const headScale = finiteOr(shape.headScale, 1);
  const roundness = clamp(finiteOr(state.bodyRoundness, shape.bodyRoundness), -1, 1);
  const hornScale = finiteOr(shape.hornScale, 1);
  return Object.freeze({
    ...anatomy,
    skullWidth: anatomy.skullWidth * headScale * (1 + roundness * 0.08),
    skullHeight: anatomy.skullHeight * headScale * (1 - roundness * 0.04),
    muzzleWidth: anatomy.muzzleWidth * Math.sqrt(headScale) * (1 + roundness * 0.06),
    muzzleLength: anatomy.muzzleLength * finiteOr(shape.muzzleLength, 1),
    neckLength: anatomy.neckLength * finiteOr(shape.neckLength, 1),
    neckWidth: anatomy.neckWidth * finiteOr(shape.neckWidth, 1),
    thoraxWidth: anatomy.thoraxWidth * finiteOr(shape.thoraxWidth, 1),
    wingSpan: anatomy.wingSpan * finiteOr(shape.wingSpan, 1),
    hornWidth: anatomy.hornWidth * hornScale,
    hornHeight: anatomy.hornHeight * hornScale,
    jawDepth: anatomy.jawDepth * (0.82 + finiteOr(shape.bellyDepth, 1) * 0.18),
    eyeScale: finiteOr(shape.eyeScale, 1),
    bellyDepth: finiteOr(shape.bellyDepth, 1),
  });
}

function drawSpecimenBackdrop(context, palette, anatomy, pose) {
  const { width, height, cx, cy, scale } = canvasMetrics;
  context.fillStyle = "#05040a";
  context.fillRect(0, 0, width, height);
  const aura = context.createRadialGradient(cx, cy * 0.92, scale * 0.08, cx, cy, scale * 1.18);
  aura.addColorStop(0, `${palette[0]}${pose.active ? "42" : "16"}`);
  aura.addColorStop(0.42, `${palette[2]}${pose.active ? "24" : "0d"}`);
  aura.addColorStop(1, "rgba(5, 4, 10, 0)");
  context.fillStyle = aura;
  context.fillRect(0, 0, width, height);
  const spacing = Math.max(30, Math.min(54, width / 18));
  context.lineWidth = 1;
  context.strokeStyle = pose.active ? `${palette[3]}18` : "rgba(232, 228, 218, 0.045)";
  for (let x = cx % spacing; x < width; x += spacing) {
    context.beginPath();
    context.moveTo(x, 0);
    context.lineTo(x, height);
    context.stroke();
  }
  for (let y = cy % spacing; y < height; y += spacing) {
    context.beginPath();
    context.moveTo(0, y);
    context.lineTo(width, y);
    context.stroke();
  }
  context.setLineDash([4, 7]);
  context.strokeStyle = "rgba(232, 228, 218, 0.16)";
  context.beginPath();
  context.moveTo(cx, Math.max(48, cy - scale * 0.88));
  context.lineTo(cx, Math.min(height - 26, cy + scale * 0.94));
  context.stroke();
  context.setLineDash([]);

  if (pose.active) {
    const rings = prefersReducedMotion ? 1 : 3;
    for (let ring = 0; ring < rings; ring += 1) {
      const travel = prefersReducedMotion
        ? 0.38
        : (pose.phase * (1.4 + ring * 0.22) + ring * 0.19) % 1;
      const radius = scale * (0.54 + travel * 0.72 + pose.projection * 0.08);
      context.beginPath();
      context.ellipse(cx, cy - scale * 0.05, radius, radius * 0.82, 0, 0, Math.PI * 2);
      context.strokeStyle = `${palette[(ring + 3) % palette.length]}${Math.round((1 - travel) * 92 + 18).toString(16).padStart(2, "0")}`;
      context.lineWidth = Math.max(1, scale * (0.004 + pose.velocity * 0.004));
      context.stroke();
    }
  }

  context.fillStyle = "rgba(232, 228, 218, 0.5)";
  context.font = "500 8px ui-monospace, SFMono-Regular, Menlo, monospace";
  context.textAlign = "left";
  context.fillText(`${anatomy.code} // ${anatomy.label.toUpperCase()}`, 18, height - 18);
  context.fillStyle = palette[0];
  context.fillRect(18, height - 10, Math.min(92, width * 0.15), 1);
}

function drawSpecimenWings(context, timeSeconds, palette, pose, anatomy) {
  const { scale } = canvasMetrics;
  const wingSweep = anatomy.proportions?.wingSweep ?? 0.5;
  const modulation = sampleModulationWave(
    state.modulationShape,
    timeSeconds * state.modulationRateHz,
    29,
  ) * state.modulationDepth * (prefersReducedMotion ? 0 : 1);
  const primaryCount = anatomy.id === "branchial-mantle" ? 5 : anatomy.id === "costal-glider" ? 8 : 7;
  const activeSpread = pose.wingFlap * (0.12 + pose.bird * 0.2) + pose.featherRuffle * 0.24;

  for (const side of [-1, 1]) {
    const shoulder = stagePoint(side * anatomy.thoraxWidth * 0.67, 0.29);
    const wrist = stagePoint(
      side * (anatomy.thoraxWidth * 0.7 + anatomy.wingSpan * (0.3 + activeSpread)),
      0.27 - wingSweep * 0.12 - pose.wingFlap * (0.08 + pose.bird * 0.13) + modulation * side * 0.018,
    );

    // A visible humerus/ulna anchors a true feather fan. There is deliberately
    // no continuous membrane between the struts: each colored blade is a vane.
    context.beginPath();
    context.moveTo(shoulder.x, shoulder.y);
    context.lineTo(wrist.x, wrist.y);
    context.strokeStyle = palette[7];
    context.lineWidth = Math.max(2, scale * 0.014);
    context.stroke();
    context.beginPath();
    context.moveTo(shoulder.x, shoulder.y);
    context.lineTo(wrist.x, wrist.y);
    context.strokeStyle = palette[3];
    context.lineWidth = specimenOutlineWidth(scale, 0.72);
    context.stroke();

    for (let index = 0; index < primaryCount; index += 1) {
      const unit = primaryCount === 1 ? 0 : index / (primaryCount - 1);
      const baseUnit = 0.18 + unit * 0.78;
      const baseX = shoulder.x + (wrist.x - shoulder.x) * baseUnit;
      const baseY = shoulder.y + (wrist.y - shoulder.y) * baseUnit;
      const spread = 0.36 + unit * 0.54 + activeSpread * (0.65 + unit * 0.55);
      const tipNx = side * (anatomy.thoraxWidth * 0.64 + anatomy.wingSpan * spread);
      let tipNy;
      if (anatomy.id === "scapular-wings") {
        tipNy = 0.31 - unit * (0.38 + wingSweep * 0.12) - pose.wingFlap * (0.17 + unit * 0.13);
      } else if (anatomy.id === "costal-glider") {
        tipNy = 0.16 + unit * 0.34 - pose.wingFlap * (0.11 + (1 - unit) * 0.12);
      } else {
        tipNy = 0.22 + Math.abs(unit - 0.45) * 0.2 - pose.wingFlap * (0.12 + unit * 0.07);
      }
      const ruffleJitter = prefersReducedMotion
        ? 0
        : Math.sin(timeSeconds * 41 + index * 2.17 + side) * pose.featherRuffle * (0.025 + unit * 0.035);
      tipNy += modulation * (0.02 + unit * 0.02) + pose.pulse * 0.008 + ruffleJitter;
      const tip = stagePoint(tipNx, tipNy);
      const featherWidth = scale * (0.052 + (1 - unit) * 0.024 + pose.bird * 0.012);
      pathFeather(context, baseX, baseY, tip.x, tip.y, featherWidth);
      context.fillStyle = specimenFillColor(
        palette[(index + (side > 0 ? 2 : 5)) % palette.length],
        pose,
        SPECIMEN_OPACITY.appendageIdle,
        SPECIMEN_OPACITY.appendageActive,
      );
      context.strokeStyle = palette[7];
      context.lineWidth = specimenOutlineWidth(scale, 0.82);
      context.fill();
      context.stroke();
      context.beginPath();
      context.moveTo(baseX, baseY);
      context.lineTo(tip.x, tip.y);
      context.strokeStyle = "rgba(255,255,255,0.78)";
      context.lineWidth = Math.max(1.5, scale * 0.005);
      context.stroke();

      // A short secondary barb makes the wing read as plumage even at phone size.
      const barb = stagePoint(
        side * (anatomy.thoraxWidth * 0.64 + anatomy.wingSpan * (spread - 0.1)),
        tipNy + 0.065 + unit * 0.018,
      );
      context.beginPath();
      context.moveTo(baseX, baseY);
      context.quadraticCurveTo(
        (baseX + barb.x) * 0.5 + side * scale * 0.025,
        (baseY + barb.y) * 0.5,
        barb.x,
        barb.y,
      );
      context.strokeStyle = specimenColorWithAlpha(palette[(index + 4) % palette.length], 0.92);
      context.lineWidth = Math.max(1.5, scale * 0.006);
      context.stroke();
    }

    // Overlapping coverts hide the mechanical shoulder joint.
    for (let index = 0; index < 4; index += 1) {
      const covert = stagePoint(
        side * (anatomy.thoraxWidth * (0.61 + index * 0.055)),
        0.29 - index * 0.025 - pose.wingFlap * index * 0.008,
      );
      context.beginPath();
      context.ellipse(covert.x, covert.y, scale * 0.074, scale * 0.034, side * -0.35, 0, Math.PI * 2);
      context.fillStyle = specimenFillColor(
        palette[(index + (side > 0 ? 5 : 1)) % palette.length],
        pose,
        SPECIMEN_OPACITY.appendageIdle,
        SPECIMEN_OPACITY.appendageActive,
      );
      context.strokeStyle = palette[7];
      context.lineWidth = specimenOutlineWidth(scale, 0.72);
      context.fill();
      context.stroke();
    }

    context.beginPath();
    context.arc(shoulder.x, shoulder.y, scale * (0.027 + pose.wingFlap * 0.01), 0, Math.PI * 2);
    context.fillStyle = specimenFillColor(
      palette[6 % palette.length],
      pose,
      SPECIMEN_OPACITY.organIdle,
      SPECIMEN_OPACITY.organActive,
    );
    context.strokeStyle = palette[3];
    context.lineWidth = specimenOutlineWidth(scale, 0.68);
    context.fill();
    context.stroke();
  }
}

function drawSpecimenThorax(context, palette, pose, anatomy) {
  const { cx, cy, scale } = canvasMetrics;
  const pressure = clamp(0.5 + state.morphBias.pressure * 0.14 + pose.breath * 0.46, 0.36, 1.28);
  const bodyInflation = 1 + pose.breath * (0.18 + pose.frog * 0.08);
  const neckReach = (finiteOr(anatomy.neckLength, 0.34) - 0.34) * 0.18;
  const jawBase = stagePoint(pose.neckWobble, 0.12 - neckReach - pose.neckStretch);
  const thoraxTop = stagePoint(0, 0.23);
  const thoraxBottom = stagePoint(
    0,
    0.88 + (finiteOr(anatomy.bellyDepth, 1) - 1) * 0.1 + pose.breath * 0.055,
  );

  // Thick cervical columns and a pectoral shelf keep the body grounded in a
  // quadruped plan, even while the source engine is playing a bird gesture.
  context.beginPath();
  context.moveTo(jawBase.x - scale * anatomy.neckWidth * (0.5 + pose.throatPulse * 0.08), jawBase.y);
  context.bezierCurveTo(
    cx - scale * anatomy.neckWidth * (0.92 + pose.throatPulse * 0.14),
    cy + scale * 0.27,
    cx - scale * anatomy.thoraxWidth * 0.82,
    cy + scale * 0.34,
    cx - scale * anatomy.thoraxWidth * 0.9,
    cy + scale * 0.43,
  );
  context.lineTo(cx + scale * anatomy.thoraxWidth * 0.9, cy + scale * 0.43);
  context.bezierCurveTo(
    cx + scale * anatomy.thoraxWidth * 0.82,
    cy + scale * 0.34,
    cx + scale * anatomy.neckWidth * (0.92 + pose.throatPulse * 0.14),
    cy + scale * 0.27,
    jawBase.x + scale * anatomy.neckWidth * (0.5 + pose.throatPulse * 0.08),
    jawBase.y,
  );
  context.closePath();
  context.fillStyle = specimenFillColor(
    palette[0],
    pose,
    SPECIMEN_OPACITY.shellIdle,
    SPECIMEN_OPACITY.shellActive,
  );
  context.strokeStyle = palette[0];
  context.lineWidth = specimenOutlineWidth(scale, 1.05);
  context.fill();
  context.stroke();

  context.beginPath();
  context.moveTo(thoraxTop.x, thoraxTop.y);
  context.bezierCurveTo(
    cx - scale * anatomy.thoraxWidth * bodyInflation,
    cy + scale * 0.28,
    cx - scale * anatomy.thoraxWidth * 0.82 * bodyInflation,
    cy + scale * 0.82,
    thoraxBottom.x,
    thoraxBottom.y,
  );
  context.bezierCurveTo(
    cx + scale * anatomy.thoraxWidth * 0.82 * bodyInflation,
    cy + scale * 0.82,
    cx + scale * anatomy.thoraxWidth * bodyInflation,
    cy + scale * 0.28,
    thoraxTop.x,
    thoraxTop.y,
  );
  context.fillStyle = specimenFillColor(
    palette[1],
    pose,
    SPECIMEN_OPACITY.shellIdle + 0.02,
    SPECIMEN_OPACITY.shellActive,
  );
  context.strokeStyle = palette[1];
  context.lineWidth = specimenOutlineWidth(scale, 1.15);
  context.fill();
  context.stroke();

  context.beginPath();
  context.moveTo(cx - scale * anatomy.thoraxWidth * 0.78 * bodyInflation, cy + scale * 0.39);
  context.quadraticCurveTo(cx, cy + scale * (0.25 - pose.breath * 0.035), cx + scale * anatomy.thoraxWidth * 0.78 * bodyInflation, cy + scale * 0.39);
  context.strokeStyle = specimenColorWithAlpha(palette[6], 0.94);
  context.lineWidth = specimenOutlineWidth(scale, 0.68);
  context.stroke();
  context.beginPath();
  context.moveTo(cx, cy + scale * 0.31);
  context.lineTo(cx, cy + scale * 0.82);
  context.strokeStyle = "rgba(232, 228, 218, 0.24)";
  context.lineWidth = 1;
  context.stroke();

  // The begging neck is a telescoping, visibly vibrating airway. Its rings
  // shear from side to side with the source pulse instead of behaving like a
  // decorative equalizer.
  const throatTopY = cy + scale * (0.08 - neckReach - pose.neckStretch);
  const throatBottomY = cy + scale * 0.46;
  context.beginPath();
  context.moveTo(jawBase.x, throatTopY);
  context.bezierCurveTo(
    cx + scale * (pose.neckWobble * 1.8 + pose.secondPulse * 0.014),
    cy + scale * 0.2,
    cx - scale * pose.neckWobble * 1.2,
    cy + scale * 0.34,
    cx,
    throatBottomY,
  );
  context.strokeStyle = "rgba(2, 3, 7, 0.82)";
  context.lineWidth = scale * (0.075 + pose.throatPulse * 0.028);
  context.stroke();
  context.strokeStyle = palette[6];
  context.lineWidth = scale * (0.049 + pose.throatPulse * 0.018);
  context.stroke();
  const neckRings = 7;
  for (let ring = 0; ring < neckRings; ring += 1) {
    const unit = ring / (neckRings - 1);
    const ringY = throatTopY + (throatBottomY - throatTopY) * unit;
    const ringX = cx + scale * pose.neckWobble * (1 - unit) + scale * pose.pulse * 0.008 * Math.sin(unit * Math.PI * 3);
    const halfWidth = scale * (0.032 + pose.throatPulse * 0.012) * (0.85 + unit * 0.3);
    context.beginPath();
    context.moveTo(ringX - halfWidth, ringY);
    context.lineTo(ringX + halfWidth, ringY);
    context.strokeStyle = `${palette[(ring + 2) % palette.length]}d8`;
    context.lineWidth = Math.max(1, scale * 0.004);
    context.stroke();
  }

  // The lower belly visibly receives the same breath as the exposed lung pair.
  context.beginPath();
  context.ellipse(
    cx,
    cy + scale * (0.75 + (finiteOr(anatomy.bellyDepth, 1) - 1) * 0.055 + pose.breath * 0.025),
    scale * anatomy.thoraxWidth * (0.48 + pose.breath * 0.16),
    scale * (0.13 * finiteOr(anatomy.bellyDepth, 1) + pose.breath * 0.085),
    0,
    0,
    Math.PI * 2,
  );
  context.fillStyle = specimenFillColor(
    palette[8 % palette.length],
    pose,
    SPECIMEN_OPACITY.shellIdle,
    SPECIMEN_OPACITY.shellActive,
  );
  context.strokeStyle = palette[8 % palette.length];
  context.lineWidth = specimenOutlineWidth(scale, 0.9);
  context.fill();
  context.stroke();

  for (const side of [-1, 1]) {
    const lung = stagePoint(side * anatomy.thoraxWidth * (0.4 + pose.breath * 0.025), 0.57 + pose.breath * 0.015);
    const width = scale * (0.12 + pressure * 0.08 + pose.mammal * 0.012);
    const height = scale * (0.21 + pressure * 0.105 + pose.frog * 0.035);
    context.beginPath();
    context.moveTo(lung.x - side * width * 0.15, lung.y - height);
    context.bezierCurveTo(lung.x + side * width, lung.y - height * 0.72, lung.x + side * width, lung.y + height * 0.72, lung.x, lung.y + height);
    context.bezierCurveTo(lung.x - side * width * 0.82, lung.y + height * 0.55, lung.x - side * width * 0.75, lung.y - height * 0.58, lung.x - side * width * 0.15, lung.y - height);
    context.fillStyle = specimenFillColor(
      side < 0 ? palette[2] : palette[5],
      pose,
      SPECIMEN_OPACITY.organIdle,
      SPECIMEN_OPACITY.organActive,
    );
    context.strokeStyle = side < 0 ? palette[2] : palette[5];
    context.lineWidth = specimenOutlineWidth(scale, 0.95);
    context.fill();
    context.stroke();
    for (let lobe = 0; lobe < 3; lobe += 1) {
      context.beginPath();
      context.ellipse(
        lung.x + side * width * (0.06 + lobe * 0.12),
        lung.y - height * 0.35 + lobe * height * 0.34,
        width * (0.68 - lobe * 0.08),
        height * 0.18,
        side * 0.12,
        0,
        Math.PI * 2,
      );
      context.strokeStyle = "rgba(255,255,255,0.62)";
      context.lineWidth = Math.max(1.25, scale * 0.0045);
      context.stroke();
    }
    context.beginPath();
    context.moveTo(cx, cy + scale * 0.42);
    context.quadraticCurveTo(lung.x - side * width * 0.32, lung.y - height * 0.35, lung.x, lung.y + height * 0.68);
    context.strokeStyle = "rgba(232, 228, 218, 0.52)";
    context.lineWidth = Math.max(1.25, scale * 0.0045);
    context.stroke();
  }
}

function drawSpecimenLimbsAndActions(context, palette, pose, anatomy) {
  const { cx, cy, scale } = canvasMetrics;
  const stepAlternation = Math.sin(pose.phase * Math.PI * 8);
  for (const side of [-1, 1]) {
    const alternatingLift = pose.motion === "footsteps"
      ? Math.max(0, stepAlternation * side) * 0.075 * pose.velocity
      : pose.motion === "jump"
        ? Math.max(0, Math.sin(Math.PI * pose.phase)) * 0.08 * pose.velocity
        : 0;
    const shoulder = stagePoint(side * anatomy.thoraxWidth * 0.54, 0.58);
    const ankle = stagePoint(
      side * anatomy.thoraxWidth * (0.48 + pose.clawSwipe * 0.12),
      0.96 + pose.bodyDrop - alternatingLift,
    );
    context.beginPath();
    context.moveTo(shoulder.x, shoulder.y);
    context.quadraticCurveTo(
      shoulder.x + side * scale * 0.055,
      cy + scale * 0.77,
      ankle.x,
      ankle.y,
    );
    context.strokeStyle = "rgba(2, 3, 7, 0.86)";
    context.lineWidth = scale * (0.058 + pose.footStrike * 0.02);
    context.stroke();
    context.strokeStyle = palette[side < 0 ? 2 : 5];
    context.lineWidth = scale * (0.038 + pose.footStrike * 0.012);
    context.stroke();
    context.beginPath();
    context.ellipse(
      ankle.x + side * scale * 0.018,
      ankle.y,
      scale * (0.075 + pose.footStrike * 0.025),
      scale * (0.034 - pose.footStrike * 0.008),
      side * 0.08,
      0,
      Math.PI * 2,
    );
    context.fillStyle = specimenFillColor(
      palette[7],
      pose,
      SPECIMEN_OPACITY.tissueIdle,
      SPECIMEN_OPACITY.tissueActive + 0.12,
    );
    context.strokeStyle = palette[0];
    context.lineWidth = specimenOutlineWidth(scale, 0.9);
    context.fill();
    context.stroke();
  }

  if (pose.footStrike > 0.04) {
    const ground = stagePoint(0, 1.02 + pose.bodyDrop);
    for (let ring = 0; ring < 3; ring += 1) {
      const spread = scale * (0.16 + ring * 0.14 + pose.footStrike * 0.12);
      context.beginPath();
      context.ellipse(ground.x, ground.y, spread, spread * 0.18, 0, 0, Math.PI * 2);
      context.strokeStyle = `${palette[(ring + 3) % palette.length]}${ring === 0 ? "d0" : "68"}`;
      context.lineWidth = Math.max(1, scale * (0.007 - ring * 0.0015));
      context.stroke();
    }
  }

  if (pose.tailSweep > 0.02) {
    const direction = Math.sin(pose.phase * Math.PI * 2) >= 0 ? 1 : -1;
    const root = stagePoint(direction * anatomy.thoraxWidth * 0.7, 0.72);
    const tip = stagePoint(direction * (anatomy.thoraxWidth + 0.74 * pose.tailSweep), 0.42 - pose.tailSweep * 0.28);
    context.beginPath();
    context.moveTo(root.x, root.y);
    context.quadraticCurveTo(
      cx + direction * scale * (anatomy.thoraxWidth + 0.28),
      cy + scale * (0.78 - pose.tailSweep * 0.56),
      tip.x,
      tip.y,
    );
    context.strokeStyle = "rgba(2, 3, 7, 0.9)";
    context.lineWidth = scale * 0.052;
    context.stroke();
    context.strokeStyle = palette[4];
    context.lineWidth = scale * 0.032;
    context.stroke();
    context.beginPath();
    context.arc(tip.x, tip.y, scale * 0.035, 0, Math.PI * 2);
    context.fillStyle = palette[8 % palette.length];
    context.fill();
  }

  if (pose.clawSwipe > 0.04) {
    const side = Math.sin(pose.phase * Math.PI * 7) >= 0 ? 1 : -1;
    for (let claw = 0; claw < 4; claw += 1) {
      const start = stagePoint(side * (anatomy.thoraxWidth + 0.12), 0.46 + claw * 0.045);
      context.beginPath();
      context.moveTo(start.x, start.y);
      context.quadraticCurveTo(
        start.x + side * scale * 0.16,
        start.y - scale * 0.08,
        start.x + side * scale * (0.34 + pose.clawSwipe * 0.22),
        start.y - scale * (0.16 + pose.clawSwipe * 0.08),
      );
      context.strokeStyle = `${palette[(claw + 3) % palette.length]}c8`;
      context.lineWidth = Math.max(1, scale * 0.006);
      context.stroke();
    }
  }
}

function drawSpecimenHorns(context, palette, pose, anatomy, skullWidth, top) {
  const { cx, scale } = canvasMetrics;
  const flare = pose.active
    ? pose.drive * 0.14 + Math.abs(pose.pulse) * 0.035 + pose.hornKick * 0.13
    : 0;
  for (const side of [-1, 1]) {
    const baseX = cx + side * scale * skullWidth * 0.62;
    const baseY = top + scale * 0.13;
    const hornWidth = anatomy.hornWidth + flare;
    const hornHeight = anatomy.hornHeight + flare * 0.72;

    if (anatomy.hornType === "ram") {
      const centerX = cx + side * scale * (skullWidth + hornWidth * 0.16);
      const centerY = top + scale * 0.16;
      context.beginPath();
      context.arc(
        centerX,
        centerY,
        scale * (hornWidth * 0.58 + flare * 0.2),
        side < 0 ? Math.PI * 0.26 : Math.PI * 0.74,
        side < 0 ? Math.PI * 2.05 : -Math.PI * 1.05,
        side > 0,
      );
      context.strokeStyle = "rgba(3, 3, 8, 0.92)";
      context.lineWidth = scale * (0.092 + flare * 0.06);
      context.stroke();
      context.strokeStyle = side < 0 ? palette[5] : palette[2];
      context.lineWidth = scale * (0.064 + flare * 0.04);
      context.stroke();
      context.beginPath();
      context.arc(centerX, centerY, scale * (hornWidth * 0.28), 0, Math.PI * 2);
      context.fillStyle = specimenFillColor(
        palette[7],
        pose,
        SPECIMEN_OPACITY.appendageIdle,
        SPECIMEN_OPACITY.appendageActive,
      );
      context.fill();
      context.strokeStyle = palette[0];
      context.lineWidth = specimenOutlineWidth(scale, 0.72);
      context.stroke();
    } else if (anatomy.hornType === "antler") {
      const tipX = cx + side * scale * (skullWidth + hornWidth * (0.72 + flare));
      const tipY = top - scale * hornHeight;
      context.beginPath();
      context.moveTo(baseX, baseY);
      context.bezierCurveTo(
        cx + side * scale * (skullWidth + hornWidth * 0.15),
        top + scale * 0.01,
        tipX - side * scale * hornWidth * 0.18,
        tipY + scale * hornHeight * 0.28,
        tipX,
        tipY,
      );
      context.strokeStyle = "rgba(3, 3, 8, 0.92)";
      context.lineWidth = scale * 0.052;
      context.stroke();
      context.strokeStyle = side < 0 ? palette[2] : palette[5];
      context.lineWidth = scale * 0.031;
      context.stroke();
      for (let tine = 0; tine < 3; tine += 1) {
        const unit = 0.25 + tine * 0.23;
        const rootX = baseX + (tipX - baseX) * unit;
        const rootY = baseY + (tipY - baseY) * unit;
        context.beginPath();
        context.moveTo(rootX, rootY);
        context.lineTo(
          rootX + side * scale * hornWidth * (0.34 + tine * 0.1 + flare),
          rootY - scale * hornHeight * (0.2 + tine * 0.055),
        );
        context.strokeStyle = palette[(tine + 4) % palette.length];
        context.lineWidth = scale * (0.023 - tine * 0.003);
        context.stroke();
      }
    } else {
      const tipX = cx + side * scale * (skullWidth + hornWidth * (0.86 + flare));
      const tipY = top - scale * hornHeight;
      context.beginPath();
      context.moveTo(baseX - side * scale * 0.045, baseY + scale * 0.035);
      context.bezierCurveTo(
        cx + side * scale * (skullWidth + hornWidth * 0.18),
        top - scale * hornHeight * 0.2,
        tipX - side * scale * hornWidth * 0.24,
        tipY + scale * hornHeight * 0.06,
        tipX,
        tipY,
      );
      context.bezierCurveTo(
        tipX - side * scale * 0.02,
        tipY + scale * 0.075,
        baseX + side * scale * 0.075,
        baseY + scale * 0.08,
        baseX - side * scale * 0.045,
        baseY + scale * 0.035,
      );
      context.closePath();
      context.fillStyle = specimenFillColor(
        side < 0 ? palette[5] : palette[2],
        pose,
        SPECIMEN_OPACITY.appendageIdle,
        SPECIMEN_OPACITY.appendageActive + 0.08,
      );
      context.strokeStyle = palette[7];
      context.lineWidth = specimenOutlineWidth(scale, 1.02);
      context.fill();
      context.stroke();
      for (let ring = 1; ring < 4; ring += 1) {
        const unit = ring / 5;
        const ringX = baseX + (tipX - baseX) * unit;
        const ringY = baseY + (tipY - baseY) * unit;
        context.beginPath();
        context.moveTo(ringX - side * scale * 0.025, ringY - scale * 0.012);
        context.lineTo(ringX + side * scale * 0.035, ringY + scale * 0.02);
        context.strokeStyle = specimenColorWithAlpha(palette[(ring + 3) % palette.length], 0.94);
        context.lineWidth = Math.max(1.5, scale * 0.0055);
        context.stroke();
      }
    }
  }
}

function drawSpecimenHead(context, palette, pose, anatomy) {
  const { cx, cy, scale } = canvasMetrics;
  const proportions = anatomy.proportions ?? {};
  const cheekVolume = (proportions.cheekVolume ?? 0.3) + pose.cheekPulse * 0.48;
  const skullWidth = anatomy.skullWidth * (0.96 + cheekVolume * 0.14 + pose.drive * 0.025);
  const top = cy - scale * anatomy.skullHeight;
  const jaw = cy + scale * (anatomy.jawDepth + pose.mouthOpen * 0.04);

  drawSpecimenHorns(context, palette, pose, anatomy, skullWidth, top);

  context.beginPath();
  context.moveTo(cx, top);
  context.bezierCurveTo(cx - scale * skullWidth * 0.62, top - scale * 0.015, cx - scale * skullWidth, cy - scale * 0.24, cx - scale * skullWidth * 0.96, cy - scale * 0.07);
  context.bezierCurveTo(cx - scale * skullWidth, cy + scale * 0.07, cx - scale * skullWidth * 0.72, jaw - scale * 0.01, cx - scale * skullWidth * 0.46, jaw);
  context.quadraticCurveTo(cx, jaw + scale * 0.07, cx + scale * skullWidth * 0.46, jaw);
  context.bezierCurveTo(cx + scale * skullWidth * 0.72, jaw - scale * 0.01, cx + scale * skullWidth, cy + scale * 0.07, cx + scale * skullWidth * 0.96, cy - scale * 0.07);
  context.bezierCurveTo(cx + scale * skullWidth, cy - scale * 0.24, cx + scale * skullWidth * 0.62, top - scale * 0.015, cx, top);
  context.closePath();
  context.fillStyle = specimenFillColor(
    palette[1],
    pose,
    SPECIMEN_OPACITY.tissueIdle,
    SPECIMEN_OPACITY.tissueActive,
  );
  context.strokeStyle = palette[6];
  context.lineWidth = specimenOutlineWidth(scale, 1.25);
  context.fill();
  context.stroke();

  context.beginPath();
  context.moveTo(cx, top + scale * 0.02);
  context.lineTo(cx, jaw + scale * 0.03);
  context.strokeStyle = "rgba(232, 228, 218, 0.34)";
  context.lineWidth = Math.max(1.5, scale * 0.005);
  context.stroke();

  for (const side of [-1, 1]) {
    const orbit = stagePoint(side * skullWidth * 0.49, -0.21);
    const eyeScale = finiteOr(anatomy.eyeScale, 1)
      * (1 + pose.eyeBurst * (1.18 + pose.bird * 0.28 + pose.rodent * 0.35));
    const eyeX = orbit.x + side * scale * pose.eyeBurst * 0.018;
    const eyeY = orbit.y - scale * pose.eyeBurst * 0.012;
    context.beginPath();
    context.ellipse(
      eyeX,
      eyeY,
      scale * 0.066 * eyeScale,
      scale * (0.054 + pose.rodent * 0.006) * eyeScale,
      0,
      0,
      Math.PI * 2,
    );
    context.fillStyle = palette[7];
    context.strokeStyle = palette[6];
    context.lineWidth = specimenOutlineWidth(scale, 0.9 + pose.eyeBurst * 0.34);
    context.fill();
    context.stroke();
    context.beginPath();
    context.arc(
      eyeX + side * state.morphBias.sourceBalance * scale * 0.014,
      eyeY,
      scale * (0.029 + pose.eyeBurst * 0.024 + pose.rodent * 0.009),
      0,
      Math.PI * 2,
    );
    context.fillStyle = palette[(side < 0 ? 3 : 8) % palette.length];
    context.fill();
    context.strokeStyle = "rgba(3, 3, 8, 0.9)";
    context.lineWidth = specimenOutlineWidth(scale, 0.62);
    context.stroke();
    context.beginPath();
    context.arc(
      eyeX + side * state.morphBias.sourceBalance * scale * 0.014,
      eyeY,
      scale * (0.012 + pose.eyeBurst * 0.008),
      0,
      Math.PI * 2,
    );
    context.fillStyle = "#05040a";
    context.fill();
    context.beginPath();
    context.arc(eyeX - side * scale * 0.016, eyeY - scale * 0.017, scale * (0.007 + pose.eyeBurst * 0.004), 0, Math.PI * 2);
    context.fillStyle = "#ffffff";
    context.fill();

    // The zygomatic arch sits below the orbit. It provides mammalian cheek
    // structure without becoming an expressive eyebrow.
    context.beginPath();
    context.moveTo(cx + side * scale * anatomy.muzzleWidth * 0.46, cy - scale * 0.105);
    context.quadraticCurveTo(cx + side * scale * skullWidth * 0.82, cy - scale * 0.01, cx + side * scale * skullWidth * 0.64, cy + scale * 0.12);
    context.strokeStyle = specimenColorWithAlpha(palette[5], 0.94);
    context.lineWidth = specimenOutlineWidth(scale, 0.72);
    context.stroke();

    context.beginPath();
    context.ellipse(
      cx + side * scale * skullWidth * 0.66,
      cy + scale * 0.02,
      scale * (0.07 + cheekVolume * 0.055),
      scale * (0.11 + cheekVolume * 0.045),
      side * 0.16,
      0,
      Math.PI * 2,
    );
    context.fillStyle = specimenFillColor(
      palette[side < 0 ? 2 : 5],
      pose,
      SPECIMEN_OPACITY.shellIdle,
      SPECIMEN_OPACITY.shellActive + 0.06,
    );
    context.fill();
    context.strokeStyle = palette[side < 0 ? 5 : 2];
    context.lineWidth = specimenOutlineWidth(scale, 0.72);
    context.stroke();
  }

  const muzzleWidth = scale * (
    anatomy.muzzleWidth
    - pose.rodent * 0.012
    - pose.beakMorph * anatomy.muzzleWidth * 0.1
    + pose.cheekPulse * 0.018
  );
  const muzzleTop = cy - scale * 0.115;
  const muzzleBottom = cy + scale * (
    anatomy.muzzleLength + state.morphBias.mouthOpening * 0.028 + pose.mouthOpen * 0.018
  );

  // A long, broad nasal bridge replaces the former pointed beak wedge.
  context.beginPath();
  context.moveTo(cx - scale * anatomy.nasalBridge * 0.48, cy - scale * 0.3);
  context.quadraticCurveTo(cx, cy - scale * 0.37, cx + scale * anatomy.nasalBridge * 0.48, cy - scale * 0.3);
  context.lineTo(cx + muzzleWidth * 0.57, muzzleTop + scale * 0.045);
  context.quadraticCurveTo(cx, muzzleTop + scale * 0.09, cx - muzzleWidth * 0.57, muzzleTop + scale * 0.045);
  context.closePath();
  context.fillStyle = specimenFillColor(
    palette[0],
    pose,
    SPECIMEN_OPACITY.shellIdle,
    SPECIMEN_OPACITY.shellActive,
  );
  context.strokeStyle = palette[3];
  context.lineWidth = specimenOutlineWidth(scale, 0.84);
  context.fill();
  context.stroke();

  context.beginPath();
  context.moveTo(cx - muzzleWidth * 0.74, muzzleTop);
  context.bezierCurveTo(cx - muzzleWidth, muzzleTop + scale * 0.025, cx - muzzleWidth, muzzleBottom - scale * 0.025, cx - muzzleWidth * 0.7, muzzleBottom);
  context.quadraticCurveTo(cx, muzzleBottom + scale * 0.045, cx + muzzleWidth * 0.7, muzzleBottom);
  context.bezierCurveTo(cx + muzzleWidth, muzzleBottom - scale * 0.025, cx + muzzleWidth, muzzleTop + scale * 0.025, cx + muzzleWidth * 0.74, muzzleTop);
  context.quadraticCurveTo(cx, muzzleTop + scale * 0.025, cx - muzzleWidth * 0.74, muzzleTop);
  context.closePath();
  context.fillStyle = specimenFillColor(
    palette[0],
    pose,
    SPECIMEN_OPACITY.appendageIdle,
    SPECIMEN_OPACITY.organActive,
  );
  context.strokeStyle = palette[5];
  context.lineWidth = specimenOutlineWidth(scale, 1.15);
  context.fill();
  context.stroke();

  const padY = muzzleTop + scale * 0.052;
  context.beginPath();
  context.ellipse(
    cx,
    padY,
    muzzleWidth * (0.66 - pose.beakMorph * 0.12),
    scale * (0.06 + pose.drive * 0.012),
    0,
    0,
    Math.PI * 2,
  );
  context.fillStyle = "rgba(8, 9, 10, 0.58)";
  context.strokeStyle = palette[3];
  context.lineWidth = specimenOutlineWidth(scale, 0.72);
  context.fill();
  context.stroke();

  for (const side of [-1, 1]) {
    const nostril = { x: cx + side * muzzleWidth * 0.35, y: padY };
    context.beginPath();
    context.ellipse(
      nostril.x,
      nostril.y,
      scale * (0.038 + pose.nostrilFlare * 0.026),
      scale * (0.019 + pose.nostrilFlare * 0.014),
      side * 0.14,
      0,
      Math.PI * 2,
    );
    context.fillStyle = "#050607";
    context.fill();
  }

  // Bird calls transiently mineralize the mammalian muzzle into a bright
  // keratin bill. It remains front-facing and anatomically attached to the
  // same nasal bridge rather than appearing as a separate prop.
  if (pose.beakMorph > 0.04) {
    context.save();
    const billHalf = muzzleWidth * (0.72 + pose.beakMorph * 0.16);
    const billTop = muzzleTop - scale * pose.beakMorph * 0.028;
    const billBase = muzzleBottom - scale * 0.035;
    context.beginPath();
    context.moveTo(cx - billHalf, billBase);
    context.quadraticCurveTo(cx - billHalf * 0.56, billTop, cx, billTop - scale * 0.035);
    context.quadraticCurveTo(cx + billHalf * 0.56, billTop, cx + billHalf, billBase);
    context.quadraticCurveTo(cx, billBase + scale * (0.035 + pose.beakMorph * 0.05), cx - billHalf, billBase);
    context.closePath();
    context.fillStyle = specimenColorWithAlpha(palette[5], clamp(0.12 + pose.beakMorph * 0.52));
    context.strokeStyle = specimenColorWithAlpha(palette[7], clamp(0.38 + pose.beakMorph * 0.62));
    context.lineWidth = specimenOutlineWidth(scale, 1.08);
    context.fill();
    context.stroke();
    context.beginPath();
    context.moveTo(cx, billTop - scale * 0.03);
    context.lineTo(cx, billBase + scale * pose.beakMorph * 0.045);
    context.strokeStyle = specimenColorWithAlpha(palette[0], clamp(0.42 + pose.beakMorph * 0.52));
    context.lineWidth = Math.max(1.5, scale * 0.0055);
    context.stroke();
    context.restore();
  }

  const mouthTop = muzzleBottom - scale * 0.027;
  const mouthHalf = muzzleWidth * (0.58 + pose.mouthOpen * 0.18 + pose.beakMorph * 0.08);
  const mouthGap = scale * (0.018 + pose.mouthOpen * (0.2 + pose.bird * 0.045) + pose.jawSnap * 0.055);
  context.beginPath();
  context.moveTo(cx - mouthHalf, mouthTop);
  context.quadraticCurveTo(cx, mouthTop - mouthGap * 0.12, cx + mouthHalf, mouthTop);
  context.bezierCurveTo(
    cx + mouthHalf * 0.88,
    mouthTop + mouthGap * 0.82,
    cx + mouthHalf * 0.42,
    mouthTop + mouthGap,
    cx,
    mouthTop + mouthGap * 1.04,
  );
  context.bezierCurveTo(
    cx - mouthHalf * 0.42,
    mouthTop + mouthGap,
    cx - mouthHalf * 0.88,
    mouthTop + mouthGap * 0.82,
    cx - mouthHalf,
    mouthTop,
  );
  context.closePath();
  context.fillStyle = "rgba(34, 6, 21, 0.76)";
  context.strokeStyle = palette[7];
  context.lineWidth = specimenOutlineWidth(scale, 1.12 + pose.mouthOpen * 0.28);
  context.fill();
  context.stroke();

  // A muscular tongue follows a slower secondary pulse and can project beyond
  // the jaw on hard attacks, like a nestling begging at the camera.
  const tongueDrop = mouthGap * (0.52 + pose.mouthOpen * 0.2)
    + scale * (pose.onset * pose.velocity * 0.045 + pose.tongueFlick * 0.18);
  context.beginPath();
  context.moveTo(cx - mouthHalf * 0.42, mouthTop + mouthGap * 0.64);
  context.bezierCurveTo(
    cx - mouthHalf * 0.25,
    mouthTop + tongueDrop,
    cx - scale * pose.secondPulse * 0.012,
    mouthTop + tongueDrop * 1.08,
    cx,
    mouthTop + tongueDrop * 1.12,
  );
  context.bezierCurveTo(
    cx + mouthHalf * 0.28,
    mouthTop + tongueDrop * 1.04,
    cx + mouthHalf * 0.4,
    mouthTop + mouthGap * 0.72,
    cx + mouthHalf * 0.42,
    mouthTop + mouthGap * 0.64,
  );
  context.closePath();
  context.fillStyle = specimenFillColor(
    palette[8 % palette.length],
    pose,
    SPECIMEN_OPACITY.organIdle + 0.16,
    SPECIMEN_OPACITY.organActive + 0.16,
  );
  context.strokeStyle = palette[1];
  context.lineWidth = specimenOutlineWidth(scale, 0.72);
  context.fill();
  context.stroke();
  context.beginPath();
  context.moveTo(cx, mouthTop + mouthGap * 0.72);
  context.lineTo(cx, mouthTop + tongueDrop * 1.04);
  context.strokeStyle = specimenColorWithAlpha(palette[7], 0.72);
  context.lineWidth = Math.max(1.5, scale * 0.005);
  context.stroke();

  const toothExposure = proportions.toothExposure ?? 0.1;
  const toothCount = pose.active ? 9 : 5;
  for (let index = 0; index < toothCount; index += 1) {
    const unit = (index + 0.5) / toothCount;
    const x = cx - mouthHalf * 0.8 + mouthHalf * 1.6 * unit;
    const toothWidth = mouthHalf * (pose.active ? 0.12 : 0.16);
    const canine = index === 1 || index === toothCount - 2;
    const toothHeight = scale * (
      0.016
      + toothExposure * 0.06
      + pose.mouthOpen * (canine ? 0.07 : 0.038)
    );
    context.beginPath();
    context.moveTo(x - toothWidth * 0.48, mouthTop + scale * 0.003);
    context.lineTo(x + toothWidth * 0.48, mouthTop + scale * 0.003);
    context.lineTo(x, mouthTop + toothHeight);
    context.closePath();
    context.fillStyle = "#fff7db";
    context.strokeStyle = "rgba(15, 7, 12, 0.82)";
    context.lineWidth = 1;
    context.fill();
    context.stroke();
  }
  if (pose.mouthOpen > 0.18) {
    const lowerCount = 6;
    for (let index = 0; index < lowerCount; index += 1) {
      const unit = (index + 0.5) / lowerCount;
      const x = cx - mouthHalf * 0.66 + mouthHalf * 1.32 * unit;
      const baseY = mouthTop + mouthGap * 0.9;
      const height = scale * (0.018 + pose.mouthOpen * 0.03);
      context.beginPath();
      context.moveTo(x - mouthHalf * 0.045, baseY);
      context.lineTo(x + mouthHalf * 0.045, baseY);
      context.lineTo(x, baseY - height);
      context.closePath();
      context.fillStyle = "#fff7db";
      context.fill();
    }
  }

  if (pose.beakMorph > 0.04) {
    // Split lower mandibles retain a surreal glimpse of teeth and tongue.
    for (const side of [-1, 1]) {
      context.beginPath();
      context.moveTo(cx + side * mouthHalf * 0.1, mouthTop + mouthGap * 0.98);
      context.lineTo(cx + side * mouthHalf, mouthTop + mouthGap * 0.45);
      context.lineTo(cx + side * mouthHalf * 0.62, mouthTop + mouthGap * 1.18);
      context.closePath();
      context.fillStyle = specimenColorWithAlpha(
        palette[5],
        clamp(0.18 + pose.beakMorph * 0.46),
      );
      context.strokeStyle = palette[7];
      context.lineWidth = specimenOutlineWidth(scale, 0.76);
      context.fill();
      context.stroke();
    }
  }

  const larynx = stagePoint(0, 0.29);
  const throatVolume = proportions.throatVolume ?? 0.7;
  const throatRadius = scale * (
    0.066
    + throatVolume * 0.052
    + pose.frog * 0.035
    + state.morphBias.roughness * 0.012
    + pose.throatPulse * (0.065 + pose.frog * 0.035)
  );
  context.beginPath();
  context.ellipse(
    larynx.x + scale * pose.pulse * 0.008,
    larynx.y,
    throatRadius,
    throatRadius * (0.72 + pose.throatPulse * 0.24),
    pose.pulse * 0.04,
    0,
    Math.PI * 2,
  );
  context.fillStyle = specimenFillColor(
    palette[6],
    pose,
    SPECIMEN_OPACITY.organIdle,
    SPECIMEN_OPACITY.organActive,
  );
  context.strokeStyle = palette[6];
  context.lineWidth = specimenOutlineWidth(scale, 1.02);
  context.fill();
  context.stroke();
  const vibrationRings = pose.active && !prefersReducedMotion ? 3 : 1;
  for (let ring = 0; ring < vibrationRings; ring += 1) {
    const ringScale = 1 + ring * 0.22 + Math.abs(pose.pulse) * 0.12;
    context.beginPath();
    context.ellipse(
      larynx.x,
      larynx.y,
      throatRadius * ringScale,
      throatRadius * (0.7 + ring * 0.13),
      0,
      0,
      Math.PI * 2,
    );
    context.strokeStyle = `${palette[(ring + 3) % palette.length]}${ring === 0 ? "b8" : "58"}`;
    context.lineWidth = Math.max(1.5, scale * 0.006);
    context.stroke();
  }
}

function drawSoundProjection(context, palette, pose, anatomy) {
  if (!pose.active || pose.projection < 0.08) return;
  const { cx, cy, scale } = canvasMetrics;
  const mouthY = cy + scale * (
    anatomy.muzzleLength
    + pose.mouthOpen * 0.12
    - pose.neckStretch
  );
  const mouthX = cx + scale * pose.neckWobble;
  const ringCount = pose.velocity > 0.82 ? 4 : pose.velocity > 0.56 ? 3 : 2;
  for (let ring = 0; ring < ringCount; ring += 1) {
    const travel = prefersReducedMotion
      ? (ring + 1) / (ringCount + 1)
      : (pose.phase * (2.8 + pose.velocity) + ring / ringCount) % 1;
    const radius = scale * (0.08 + travel * (0.28 + pose.velocity * 0.2));
    context.beginPath();
    context.ellipse(
      mouthX,
      mouthY,
      radius * (0.78 + pose.beakMorph * 0.2),
      radius,
      pose.pulse * 0.04,
      0,
      Math.PI * 2,
    );
    context.strokeStyle = `${palette[(ring + 3) % palette.length]}${Math.round((1 - travel) * 138 + 30).toString(16).padStart(2, "0")}`;
    context.lineWidth = Math.max(1, scale * (0.004 + pose.velocity * 0.009 * (1 - travel)));
    context.stroke();
  }

  if (pose.velocity > 0.74) {
    const shardCount = 6;
    for (let shard = 0; shard < shardCount; shard += 1) {
      const angle = (shard / shardCount) * Math.PI * 2 + pose.colorBeat * 0.31;
      const distance = scale * (0.18 + pose.onset * 0.18 + (shard % 2) * 0.045);
      const x = mouthX + Math.cos(angle) * distance;
      const y = mouthY + Math.sin(angle) * distance;
      context.save();
      context.translate(x, y);
      context.rotate(angle + Math.PI * 0.5);
      context.beginPath();
      context.moveTo(0, -scale * 0.034);
      context.lineTo(scale * 0.02, scale * 0.022);
      context.lineTo(-scale * 0.02, scale * 0.022);
      context.closePath();
      context.fillStyle = palette[(shard + 1) % palette.length];
      context.fill();
      context.restore();
    }
  }
}

function drawSpecimenControls(context, timeSeconds, palette) {
  const size = clamp(canvasMetrics.scale * 0.026, 6, 10);
  context.font = "600 6px ui-monospace, SFMono-Regular, Menlo, monospace";
  context.textAlign = "center";
  context.textBaseline = "top";
  for (const [index, handle] of controlHandlePositions(timeSeconds).entries()) {
    context.fillStyle = pointerDrag?.id === handle.id ? "#f4eee9" : palette[(index + 2) % palette.length];
    context.fillRect(handle.x - size, handle.y - size * 0.62, size * 2, size * 1.24);
    context.strokeStyle = "rgba(244, 238, 233, 0.82)";
    context.lineWidth = 1;
    context.strokeRect(handle.x - size, handle.y - size * 0.62, size * 2, size * 1.24);
    if (canvasMetrics.scale >= 165) {
      context.fillStyle = "rgba(244, 238, 233, 0.68)";
      context.fillText(handle.label, handle.x, handle.y + size * 0.9);
    }
  }
}

function drawCreature(timeSeconds) {
  const { dpr, cx, cy, scale } = canvasMetrics;
  drawing.setTransform(dpr, 0, 0, dpr, 0, 0);
  drawing.lineJoin = "round";
  drawing.lineCap = "round";
  const performanceState = displayPerformanceState(timeSeconds);
  const pose = familyPose(displaySound(), timeSeconds, performanceState);
  const palette = rhythmicPalette(selectedPalette(), pose);
  const anatomy = activeAnatomyDesign();
  drawSpecimenBackdrop(drawing, palette, anatomy, pose);

  // High-velocity onsets physically project the specimen toward the viewer.
  // Controls stay in their stable opaque layer, so the exaggerated body never
  // makes a drag target run away from the pointer.
  const bodyTransform = persistentBodyTransform();
  const projectX = bodyTransform.x * (1 + pose.jump * 0.62 + pose.projection * 0.018);
  const projectY = bodyTransform.y * (1 + pose.jump * 0.82 + pose.projection * 0.032);
  drawing.save();
  drawing.translate(cx, cy - scale * pose.jump);
  drawing.scale(projectX, projectY);
  drawing.translate(-cx, -cy);
  drawSpecimenWings(drawing, timeSeconds, palette, pose, anatomy);
  drawSpecimenThorax(drawing, palette, pose, anatomy);
  drawSpecimenLimbsAndActions(drawing, palette, pose, anatomy);
  drawing.save();
  drawing.translate(
    scale * (pose.neckWobble + pose.tailSweep * 0.035),
    -scale * (pose.neckStretch + pose.headBob),
  );
  drawSpecimenHead(drawing, palette, pose, anatomy);
  drawing.restore();
  drawSoundProjection(drawing, palette, pose, anatomy);
  drawing.restore();
  drawSpecimenControls(drawing, timeSeconds, palette);
}

function updateHud(timeSeconds) {
  const sound = displaySound();
  const performanceState = displayPerformanceState(timeSeconds);
  const source = resolveSourceControls(performanceState);
  const animal = ANIMALS[performanceState.animalId] ?? ANIMALS.raven;
  const soundLabel = sound
    ? `${sound.label} · ${sound.articulation?.mechanism ?? `${animal.label.toLowerCase()} ${CALL_GESTURES[sound.callId].label.toLowerCase()}`}`
    : "ready to morph";
  outputStateValue($("soundReadout"), soundLabel);
  outputStateValue(
    $("stageSoundReadout"),
    sound ? `${sound.label} / ${selectedBodyPreset().label} body` : selectedBodyPreset().label,
  );
  outputStateValue($("sourceReadout"), `${MODEL_FAMILY_LABELS[animal.model] ?? MODEL_LABELS[animal.model]} · ${formatFrequency(source.frequencyHz)}`);
  outputStateValue($("tractReadout"), `${(finiteOr(telemetry.tractLengthM, performanceState.tractLengthM) * 100).toFixed(1)} cm · ${Math.max(1, Math.round(finiteOr(telemetry.sections, 0)))} sections`);
  outputStateValue($("pressureReadout"), performanceState.active
    ? `${formatPercent(clamp(performanceState.pressure))} · ${formatPercent(clamp(telemetry.rms * 8))} output`
    : "resting");
}

function animationFrame(timestamp) {
  consumeVisualSchedule();
  const nowSeconds = audioContext?.currentTime ?? timestamp / 1_000;
  const paintInterval = prefersReducedMotion ? 100 : compactMedia?.matches ? 1_000 / 30 : 1_000 / 60;
  if (timestamp - lastCanvasPaint >= paintInterval) {
    drawCreature(nowSeconds);
    lastCanvasPaint = timestamp;
  }
  if (timestamp - lastHudPaint >= 80) {
    updateHud(nowSeconds);
    lastHudPaint = timestamp;
  }
  requestAnimationFrame(animationFrame);
}

function canvasCoordinates(event) {
  const bounds = canvas.getBoundingClientRect();
  return {
    x: (event.clientX - bounds.left) * canvasMetrics.width / Math.max(1, bounds.width),
    y: (event.clientY - bounds.top) * canvasMetrics.height / Math.max(1, bounds.height),
  };
}

function distance(left, right) {
  return Math.hypot(left.x - right.x, left.y - right.y);
}

function updateHandleFromPointer(id, point) {
  const bodyTransform = persistentBodyTransform();
  const nx = (point.x - canvasMetrics.cx) / canvasMetrics.scale / bodyTransform.x;
  const ny = (point.y - canvasMetrics.cy) / canvasMetrics.scale / bodyTransform.y;
  const anatomy = activeAnatomyDesign();
  let value = null;
  if (id === "pressure") value = 1 + clamp((0.62 - ny) / 0.12, -1, 1) * 0.8;
  else if (id === "tension") value = clamp(nx / 0.12, -1, 1);
  else if (id === "beak") value = clamp((ny - 0.08) / 0.1, -1, 1);
  else if (id === "tract") value = 2 ** (clamp((ny - 0.47) / 0.13, -1, 1) * 1.7);
  else if (id === "cavity") value = clamp((-nx - anatomy.skullWidth * 0.72) / 0.08, -1, 1);
  else if (id === "roughness") value = clamp((nx - anatomy.skullWidth * 0.72) / 0.08, -1, 1);
  else if (id === "split") value = clamp((nx + 0.11) * 6, -1, 1);
  else if (id === "balance") value = clamp((nx - 0.11) * 6, -1, 1);
  else if (id === "morphMs") value = 12 + clamp((ny - 0.68) / 0.15) * 228;
  else if (id === "vibratoRate") value = clamp((-nx - 0.55) / Math.max(0.1, anatomy.wingSpan - 0.55) * 20, 0, 20);
  else if (id === "vibratoDepth") value = clamp((nx - 0.55) / Math.max(0.1, anatomy.wingSpan - 0.55) * 6, 0, 6);
  else if (id === "modulationRate") value = clamp((anatomy.wingLift + 0.22 - ny) / 0.35 * 20, 0, 20);
  else if (id === "modulationDepth") value = clamp((anatomy.wingLift + 0.22 - ny) / 0.35, 0, 1);
  const element = $(id);
  if (element && value != null) {
    element.value = String(value);
    element.dispatchEvent(new Event("input", { bubbles: true }));
  }
}

function handleCanvasPointerDown(event) {
  const point = canvasCoordinates(event);
  const handleRadius = Math.max(22, canvasMetrics.scale * 0.075);
  const handle = controlHandlePositions(audioContext?.currentTime ?? performance.now() / 1_000)
    .find((candidate) => distance(candidate, point) <= handleRadius);
  if (!handle) return;
  event.preventDefault();
  pointerDrag = { id: handle.id, pointerId: event.pointerId };
  canvas.setPointerCapture?.(event.pointerId);
  updateHandleFromPointer(handle.id, point);
}

function handleCanvasPointerMove(event) {
  if (!pointerDrag || pointerDrag.pointerId !== event.pointerId) return;
  event.preventDefault();
  updateHandleFromPointer(pointerDrag.id, canvasCoordinates(event));
}

function endCanvasPointer(event) {
  if (!pointerDrag || pointerDrag.pointerId !== event.pointerId) return;
  const label = pointerDrag.id;
  pointerDrag = null;
  canvas.releasePointerCapture?.(event.pointerId);
  announce(`${label} anatomy set; the one active airway was retargeted`);
}

function bindCanvas() {
  canvas.addEventListener("pointerdown", handleCanvasPointerDown);
  canvas.addEventListener("pointermove", handleCanvasPointerMove);
  canvas.addEventListener("pointerup", endCanvasPointer);
  canvas.addEventListener("pointercancel", endCanvasPointer);
  canvas.addEventListener("contextmenu", (event) => event.preventDefault());
}

function bindKeyboard() {
  globalThis.addEventListener("keydown", (event) => {
    if (event.repeat || event.altKey || event.ctrlKey || event.metaKey) return;
    if (event.target?.matches?.("input, select, textarea, button, summary, [contenteditable='true']")) return;
    if (event.code === "Space") {
      event.preventDefault();
      toggleSequence();
      return;
    }
    if (event.code === "Escape") {
      event.preventDefault();
      stopSequence();
      return;
    }
    if (event.code === "ArrowRight" || event.code === "ArrowLeft") {
      event.preventDefault();
      setBodyPreset(cyclePreset(
        CREATURAZOID_BODY_PRESETS,
        state.bodyPresetId,
        event.code === "ArrowRight" ? 1 : -1,
      ).id);
      return;
    }
    if (event.code === "ArrowDown" || event.code === "ArrowUp") {
      event.preventDefault();
      setSequencePreset(cyclePreset(
        CREATURAZOID_SEQUENCE_PRESETS,
        currentPatternId,
        event.code === "ArrowDown" ? 1 : -1,
      ).id);
      return;
    }
    const sound = creaturazoidSoundForKey(event.key);
    if (!sound) return;
    event.preventDefault();
    triggerSound(sound, 0.9);
  });
}

async function disposeAudio() {
  stopSequence({ silence: true, announceState: false });
  try { graph?.releaseOutput?.(); } catch { /* Output may already be gone. */ }
  try { graph?.sourceNode?.disconnect(); } catch { /* Graph may already be disconnected. */ }
  try { await audioContext?.close(); } catch { /* Page teardown does not need to surface errors. */ }
  graph = null;
  audioContext = null;
}

function initialize() {
  populateSelects();
  buildPadGrid();
  buildSequenceGrid({ preserveScroll: false });
  bindControls();
  bindCanvas();
  bindKeyboard();
  syncControls();
  setAudioPresentation("off");
  resizeCanvas();
  const resizeObserver = new ResizeObserver(resizeCanvas);
  resizeObserver.observe(stageWrap);
  globalThis.addEventListener("pagehide", () => { void disposeAudio(); }, { once: true });
  document.addEventListener("visibilitychange", () => {
    if (document.hidden && sequenceRunning) stopSequence();
  });
  requestAnimationFrame(animationFrame);
}

initialize();

import {
  cloneDefaultFmDrumVoices,
  FM_DRUM_STORAGE_KEY,
  sanitizeFmDrumVoice,
} from "./fm-drums.js";
import {
  GRAPH_DRUM_PERCUSSION_STYLES,
  MAX_GRAPH_KARPLUS_ATTACKS_PER_FRAME,
  MAX_GRAPH_PHYSICAL_ATTACKS_PER_FRAME,
  GraphDrumAudio,
  graphDrumPercussionVoice,
  graphDrumStyleIsKarplus,
  graphDrumStyleUsesPhysicalEngine,
  sanitizeGraphDrumPercussionStyle,
} from "./graph-drum-audio.js?v=graph-instruments-20260830-3";
import {
  GRAPH_PRESETS,
  edgeAudioParameters,
  generateGraph,
  graphSinkNodeIds,
} from "./graph-delay.js?v=graph-instruments-20260830-3";
import {
  GRAPH_INSTRUMENT_PATCHES,
  MAX_GRAPH_EVENT_SCHEDULE,
  MAX_GRAPH_INSTRUMENT_NODES,
  MIN_GRAPH_EVENT_AMPLITUDE,
  coalesceGraphEvents,
  graphDrumVoiceIndex,
  graphPulseIntervalSeconds,
  graphSynthVoice,
  mappedGraphDrumVoice,
  scheduleGraphPulse,
} from "./graph-instruments.js?v=graph-instruments-20260830-3";
import {
  MAX_GRAPH_SYNTH_ACTIVE_VOICES,
  GraphSynthAudio,
} from "./graph-synth-audio.js?v=graph-instruments-20260830-3";

const TAU = Math.PI * 2;
const AUDIO_LOOKAHEAD_SECONDS = 0.09;
const MAX_CLOCK_CATCH_UP = 4;
const MAX_VISIBLE_RUNS = 4;
const MAX_ACTIVE_RUNS = 64;
const MAX_DRUM_EVENTS_PER_PULSE = 768;
const MAX_SYNTH_EVENTS_PER_PULSE = 1_024;
const MAX_AUDIO_ATTACKS_PER_FRAME = 96;
const MAX_IN_FLIGHT_AUDIO_TRIGGERS = 64;
const AUDIO_FAILURE_THRESHOLD = 3;
const AUDIO_FAILURE_WINDOW_MS = 500;
const AUDIO_PROTECTION_BASE_MS = 750;
const AUDIO_PROTECTION_MAX_MS = 8_000;
const MIN_MOTION_TEMPLATE_INTERVAL_MS = 250;
const MAX_MOTION_TEMPLATE_INTERVAL_MS = 1_200;
const MOTION_TEMPLATE_COST_MULTIPLIER = 8;
const FATAL_AUDIO_ERROR_NAMES = new Set([
  "InvalidStateError",
  "OperationError",
  "QuotaExceededError",
]);
const EDGE_SWITCH_HIT_RADIUS = 14;
const NODE_HIT_RADIUS = 23;
const DEFAULT_PATCH = "layeredGlass";
const GRAPH_PRESET_STATE_KEYS = Object.freeze([
  "topology", "nodeCount", "density", "seed", "baseDelay", "distanceRatio",
  "timeCurve", "nodePass", "feedback", "feedbackTone", "tempo",
  "triggerScope",
]);

const clamp = (value, minimum = 0, maximum = 1, fallback = minimum) => {
  const number = Number(value);
  return Math.min(maximum, Math.max(minimum, Number.isFinite(number) ? number : fallback));
};

const percent = (value) => `${Math.round(clamp(value) * 100)}%`;

const DRUM_MAPPING_DETAILS = Object.freeze({
  "position-grid": Object.freeze({
    label: "position grid",
    description: "Each node's 4 × 4 stage position chooses one drum.",
    legend: [["Vertical", "drum row"], ["Horizontal", "voice column"], ["Edge turn", "tuning"], ["Cycle pass", "level + tone loss"]],
  }),
  "degree-turn": Object.freeze({
    label: "degree × turn",
    description: "Incoming and outgoing degree choose the row; the signed arrival turn chooses the column.",
    legend: [["Node degree", "drum row"], ["Arrival turn", "voice column"], ["Node height", "tuning"], ["Cycle pass", "level + tone loss"]],
  }),
  "path-phase": Object.freeze({
    label: "path × cycle",
    description: "Path depth chooses the row while cycle pass and route identity rotate the voice column.",
    legend: [["Path depth", "drum row"], ["Route phase", "voice column"], ["Edge turn", "tuning"], ["Cycle pass", "level + tone loss"]],
  }),
});

const SYNTH_MAPPING_DETAILS = Object.freeze({
  turn: Object.freeze({
    label: "inherited turns",
    description: "Every turn adds a local interval to the pitch inherited from the previous route.",
    legend: [["Turn", "inherited pitch"], ["Node height", "stereo"], ["Degree", "modulation"], ["Cycle pass", "level + brightness loss"]],
  }),
  height: Object.freeze({
    label: "node height",
    description: "Higher nodes sound higher while route turns remain visible but do not retune the voice.",
    legend: [["Node height", "pitch"], ["Node height", "stereo"], ["Degree", "modulation"], ["Cycle pass", "level + brightness loss"]],
  }),
  degree: Object.freeze({
    label: "node degree",
    description: "The number of connected routes selects pitch while merges and branches add timbral pressure.",
    legend: [["Total degree", "pitch"], ["Node height", "stereo"], ["Merge / split", "modulation"], ["Cycle pass", "level + brightness loss"]],
  }),
  progress: Object.freeze({
    label: "graph progress",
    description: "Left-to-right graph position crosses the selected pitch lattice from low to high.",
    legend: [["Horizontal", "pitch"], ["Node height", "stereo"], ["Degree", "modulation"], ["Cycle pass", "level + brightness loss"]],
  }),
});

export function graphInstrumentPresetState(name, mode = "synth") {
  const patch = GRAPH_INSTRUMENT_PATCHES[name];
  if (!patch) return null;
  const instrumentMode = mode === "drums" ? "drums" : "synth";
  const state = { graphPatch: name };
  for (const key of GRAPH_PRESET_STATE_KEYS) {
    // Attack-point selection is a performance/sound choice on Graph Synth.
    // Preserving it prevents graph presets from introducing long silent waits.
    if (instrumentMode === "synth" && key === "triggerScope") continue;
    if (patch[key] !== undefined) state[key] = patch[key];
  }
  const pulseBeats = patch.pulseBeats ?? patch.pulseDivision;
  if (pulseBeats !== undefined) state.pulseDivision = pulseBeats;
  if (instrumentMode === "drums") Object.assign(state, patch.drums ?? {});
  return state;
}

export function graphInstrumentDefaultState(mode = "synth") {
  const instrumentMode = mode === "drums" ? "drums" : "synth";
  const seedNote = instrumentMode === "drums" ? 60 : 57;
  return {
    playing: false,
    audio: false,
    output: instrumentMode === "drums" ? 0.58 : 0.64,
    triggerScope: "all",
    feedbackTone: 0.78,
    seedNote,
    nodeMoving: false,
    nodeMotionMode: "wiggle",
    nodeMotionSpeed: 0.12,
    nodeMotionAmount: 0.07,
    nodeMotionPhase: 0,
    mappingMode: instrumentMode === "drums" ? "position-grid" : "turn",
    percussionStyle: "circuit",
    pitchDepth: 12,
    turnPitchDepth: 9,
    characterDepth: 0.72,
    baseFrequency: midiFrequency(seedNote),
    pitchRange: 2,
    tuningMode: "equal",
    edoDivisions: instrumentMode === "synth" ? 19 : 12,
    turnPitchScale: 0.55,
    soundMode: instrumentMode === "synth" ? "fm" : "sine",
    modulationIndex: 2.8,
    modulationRatio: 2,
    articulation: "trigger",
    noteDuration: 210,
    attack: 8,
    decay: 90,
    sustain: 0.34,
    release: 220,
    stereoSpread: 0.84,
    ...graphInstrumentPresetState(DEFAULT_PATCH, instrumentMode),
  };
}

function loadDrumBank(storage) {
  const fallback = cloneDefaultFmDrumVoices();
  try {
    const stored = JSON.parse(storage?.getItem?.(FM_DRUM_STORAGE_KEY));
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
  element?.setAttribute?.("aria-pressed", String(Boolean(pressed)));
}

function noteName(frequency) {
  const exactMidi = 69 + 12 * Math.log2(Math.max(1, frequency) / 440);
  const midi = Math.round(exactMidi);
  const names = ["C", "C♯", "D", "E♭", "E", "F", "F♯", "G", "A♭", "A", "B♭", "B"];
  const cents = Math.round((exactMidi - midi) * 100);
  return `${names[((midi % 12) + 12) % 12]}${Math.floor(midi / 12) - 1}${Math.abs(cents) >= 1 ? `${cents > 0 ? "+" : ""}${cents}¢` : ""}`;
}

function midiFrequency(note) {
  return 440 * 2 ** ((clamp(note, 0, 127, 69) - 69) / 12);
}

/** Initialize either authored Graph instrument page without touching globals at import time. */
export function initializeGraphInstrument({
  mode = "synth",
  runtime = globalThis,
  documentObject = runtime.document,
  audioEngine = null,
} = {}) {
  const instrumentMode = mode === "drums" ? "drums" : "synth";
  const $ = (id) => documentObject?.getElementById?.(id) ?? null;
  const canvas = $("stage");
  const stageWrap = $("stageWrap");
  if (!canvas || !stageWrap) return null;
  const context = canvas.getContext?.("2d", { desynchronized: true });
  if (!context) return null;

  const state = graphInstrumentDefaultState(instrumentMode);
  const initialState = Object.freeze({ ...state });
  const reducedMotionQuery = runtime.matchMedia?.("(prefers-reduced-motion: reduce)") ?? null;
  const audio = audioEngine ?? (instrumentMode === "drums"
    ? new GraphDrumAudio(runtime)
    : new GraphSynthAudio(runtime));
  const voices = instrumentMode === "drums"
    ? loadDrumBank(runtime.localStorage)
    : [];
  let model = generateGraph({
    type: state.topology,
    nodeCount: state.nodeCount,
    density: state.density,
    seed: state.seed,
    maxNodes: MAX_GRAPH_INSTRUMENT_NODES,
  });
  let displayModel = model;
  let reverseEdgeKeys = new Set(model.edges.map((edge) => `${edge.to}>${edge.from}`));
  let edgeSwitchStates = new Map(model.edges.map((edge) => [`${edge.from}>${edge.to}`, true]));
  let selectedNodeId = 0;
  let draggingNodeId = null;
  let hoveredEdgeId = null;
  let cssWidth = 1;
  let cssHeight = 1;
  let pixelRatio = 1;
  let scheduledFrame = 0;
  let lastFrameTime = runtime.performance?.now?.() ?? 0;
  let nextPulseTime = null;
  let pulseTemplate = null;
  let activeRuns = [];
  let pulseSerial = 0;
  let soundedEventCount = 0;
  let latestEvent = null;
  let disposed = false;
  let frameAttackCount = 0;
  let nodeWalkOffsets = [];
  let nodeWalkVelocities = [];
  let lastMotionTemplateTime = -Infinity;
  let audioClockContext = null;
  const inFlightAudioTriggers = new Set();
  let shedAudioEventCount = 0;
  let audioFailureTimes = [];
  let audioProtectionUntil = 0;
  let audioProtectionLevel = 0;
  let lastAdmittedRunId = null;
  let motionTemplateBuildCount = 0;
  let motionTemplateIntervalMs = MIN_MOTION_TEMPLATE_INTERVAL_MS;
  let fatalAudioProtection = false;
  let audioRecoveryPromise = null;

  const scheduleFrame = () => {
    if (!scheduledFrame) scheduledFrame = runtime.requestAnimationFrame?.(frame) ?? 0;
  };

  const edgeKey = (edge) => `${edge.from}>${edge.to}`;
  const edgeEnabled = (edge) => edgeSwitchStates.get(edgeKey(edge)) ?? true;
  const enabledFlags = () => model.edges.map(edgeEnabled);

  function resetNodeWalkState() {
    nodeWalkOffsets = model.nodes.map(() => ({ x: 0, y: 0 }));
    nodeWalkVelocities = model.nodes.map((node) => {
      const angle = ((node.id * 0.61803398875 + state.seed * 0.071) % 1) * TAU;
      return { x: Math.cos(angle) * 0.025, y: Math.sin(angle) * 0.025 };
    });
  }

  function geometryModel() {
    if (!state.nodeMoving || reducedMotionQuery?.matches) return model;
    const amount = state.nodeMotionAmount;
    return {
      ...model,
      nodes: model.nodes.map((node) => {
        let offsetX;
        let offsetY;
        if (state.nodeMotionMode === "random") {
          offsetX = nodeWalkOffsets[node.id]?.x ?? 0;
          offsetY = nodeWalkOffsets[node.id]?.y ?? 0;
        } else {
          const phase = state.nodeMotionPhase * TAU;
          const nodePhase = node.id * 1.713;
          if (state.nodeMotionMode === "orbit") {
            offsetX = Math.cos(phase + nodePhase) * amount;
            offsetY = Math.sin(phase + nodePhase) * amount;
          } else {
            offsetX = Math.sin(phase + nodePhase) * amount;
            offsetY = Math.cos(phase * 0.83 + node.id * 2.137) * amount * 0.68;
          }
        }
        return {
          ...node,
          x: clamp(node.x + offsetX, 0.02, 0.98, node.x),
          y: clamp(node.y + offsetY, 0.02, 0.98, node.y),
        };
      }),
    };
  }

  function advanceNodeMotion(delta) {
    if (!state.nodeMoving || reducedMotionQuery?.matches) return false;
    if (state.nodeMotionMode !== "random") {
      state.nodeMotionPhase = (state.nodeMotionPhase + state.nodeMotionSpeed * delta) % 1;
      return true;
    }
    if (nodeWalkOffsets.length !== model.nodes.length) resetNodeWalkState();
    const acceleration = 0.12 + state.nodeMotionSpeed * 0.7;
    const maximumVelocity = 0.025 + state.nodeMotionSpeed * 0.24;
    for (const node of model.nodes) {
      const offset = nodeWalkOffsets[node.id];
      const velocity = nodeWalkVelocities[node.id];
      const randomX = runtime.Math?.random?.() ?? Math.random();
      const randomY = runtime.Math?.random?.() ?? Math.random();
      velocity.x += (randomX * 2 - 1) * acceleration * delta;
      velocity.y += (randomY * 2 - 1) * acceleration * delta;
      const damping = Math.exp(-delta * 1.1);
      velocity.x *= damping;
      velocity.y *= damping;
      const speed = Math.hypot(velocity.x, velocity.y);
      if (speed > maximumVelocity) {
        velocity.x *= maximumVelocity / speed;
        velocity.y *= maximumVelocity / speed;
      }
      offset.x += velocity.x * delta;
      offset.y += velocity.y * delta;
      const distance = Math.hypot(offset.x, offset.y);
      if (distance > state.nodeMotionAmount) {
        const normalX = offset.x / distance;
        const normalY = offset.y / distance;
        offset.x = normalX * state.nodeMotionAmount;
        offset.y = normalY * state.nodeMotionAmount;
        const outwardSpeed = velocity.x * normalX + velocity.y * normalY;
        if (outwardSpeed > 0) {
          velocity.x -= normalX * outwardSpeed * 1.8;
          velocity.y -= normalY * outwardSpeed * 1.8;
        }
      }
    }
    return true;
  }

  resetNodeWalkState();

  function showError(error) {
    const target = $("audioError");
    if (!target) return;
    target.textContent = error instanceof Error ? error.message : String(error);
    target.hidden = false;
  }

  function clearError() {
    if ($("audioError")) $("audioError").hidden = true;
  }

  function performanceNow() {
    return Number(runtime.performance?.now?.()) || 0;
  }

  function resetAudioProtection({ resetLevel = true } = {}) {
    audioFailureTimes = [];
    audioProtectionUntil = 0;
    fatalAudioProtection = false;
    if (resetLevel) audioProtectionLevel = 0;
  }

  function audioProtectionActive(now = performanceNow()) {
    if (fatalAudioProtection) return true;
    if (!(audioProtectionUntil > 0)) return false;
    if (now < audioProtectionUntil) return true;
    audioProtectionUntil = 0;
    audioFailureTimes = [];
    audioProtectionLevel = Math.max(0, audioProtectionLevel - 1);
    return false;
  }

  function fatalAudioError(error) {
    return FATAL_AUDIO_ERROR_NAMES.has(error?.name);
  }

  function engageFatalAudioProtection(error) {
    if (disposed || fatalAudioProtection) return;
    fatalAudioProtection = true;
    audioProtectionUntil = Infinity;
    audioProtectionLevel = Math.min(4, audioProtectionLevel + 1);
    audioFailureTimes = [];
    state.playing = false;
    state.audio = false;
    activeRuns = [];
    nextPulseTime = null;
    audioClockContext = null;
    inFlightAudioTriggers.clear();
    setPressed($("playButton"), false);
    setPressed($("audioButton"), false);
    $("audioState").textContent = "off";
    audio.silence?.();
    if (!audioRecoveryPromise) {
      try {
        audioRecoveryPromise = Promise.resolve(audio.close?.()).catch(() => {});
      } catch {
        audioRecoveryPromise = Promise.resolve();
      }
    }
    const reason = error instanceof Error ? error.message : String(error ?? "Web Audio failed");
    showError(new Error(`Audio was safely stopped: ${reason}`));
    $("liveStatus").textContent = "Web Audio was safely reset. Use Send one, Play, MIDI, or Audio to start a fresh context.";
    updateUi();
  }

  function engageAudioProtection(error, { immediate = false } = {}) {
    if (disposed || !state.audio) return;
    if (fatalAudioError(error)) {
      engageFatalAudioProtection(error);
      return;
    }
    const now = performanceNow();
    if (audioProtectionActive(now)) return;
    audioFailureTimes = audioFailureTimes.filter(
      (failureTime) => failureTime >= now - AUDIO_FAILURE_WINDOW_MS,
    );
    audioFailureTimes.push(now);
    if (!immediate && audioFailureTimes.length < AUDIO_FAILURE_THRESHOLD) {
      showError(error);
      return;
    }
    audioProtectionLevel = Math.min(4, audioProtectionLevel + 1);
    const cooldown = Math.min(
      AUDIO_PROTECTION_MAX_MS,
      AUDIO_PROTECTION_BASE_MS * 2 ** (audioProtectionLevel - 1),
    );
    audioProtectionUntil = now + cooldown;
    audioFailureTimes = [];
    audio.silence?.();
    const reason = error instanceof Error ? error.message : String(error ?? "audio overload");
    showError(new Error(`Audio protection paused new graph attacks: ${reason}`));
    $("liveStatus").textContent = `Audio protected for ${(cooldown / 1_000).toFixed(2)} s; graph motion and controls remain available.`;
  }

  function audioSchedulingAvailable() {
    if (!state.audio || !audio.context || audioProtectionActive()) return false;
    const contextState = audio.context.state;
    if (contextState && contextState !== "running") {
      const error = new Error(`Web Audio is ${contextState}; use a sound control to resume it.`);
      if (contextState === "closed") error.name = "InvalidStateError";
      engageAudioProtection(
        error,
        { immediate: true },
      );
      return false;
    }
    return true;
  }

  function submitAudioTrigger(run, trigger) {
    if (!audioSchedulingAvailable()) return false;
    if (inFlightAudioTriggers.size >= MAX_IN_FLIGHT_AUDIO_TRIGGERS) return false;
    const request = {};
    inFlightAudioTriggers.add(request);
    lastAdmittedRunId = run.id;
    soundedEventCount += 1;
    let result;
    try {
      result = trigger();
    } catch (error) {
      inFlightAudioTriggers.delete(request);
      soundedEventCount = Math.max(0, soundedEventCount - 1);
      engageAudioProtection(error);
      return false;
    }
    Promise.resolve(result)
      .then((rendered) => {
        if (rendered?.scheduled === false || rendered?.skipped === true) {
          shedAudioEventCount += 1;
        }
      })
      .catch((error) => engageAudioProtection(error))
      .finally(() => {
        inFlightAudioTriggers.delete(request);
      });
    return true;
  }

  function timelineNow(frameTime = runtime.performance?.now?.() ?? 0) {
    return state.audio && audio.context
      ? Number(audio.context.currentTime) || 0
      : frameTime / 1_000;
  }

  function invalidatePulseTemplate({
    clearRuns = true,
    silence = false,
    resetClock = false,
  } = {}) {
    pulseTemplate = null;
    if (clearRuns) activeRuns = [];
    if (resetClock) nextPulseTime = null;
    if (silence) audio.silence?.();
  }

  function audibleLeafIds(graph) {
    const leaves = graph.nodes
      .filter((node) => {
        const processed = (graph.indegree?.[node.id] ?? 0) > 0;
        const hasForwardOutput = graph.edges.some((edge) => (
          edge.from === node.id && !edge.feedbackEdge && edgeEnabled(edge)
        ));
        return processed && !hasForwardOutput;
      })
      .map(({ id }) => id);
    return new Set(leaves.length ? leaves : graphSinkNodeIds(graph));
  }

  function eventAudible(event, leaves) {
    if (state.triggerScope === "leaves") {
      return event.kind === "node" && leaves.has(event.nodeId);
    }
    return event.kind === "node";
  }

  function buildPulseTemplate() {
    if (pulseTemplate) return pulseTemplate;
    const eventCap = MAX_GRAPH_EVENT_SCHEDULE;
    const graph = geometryModel();
    const scheduled = scheduleGraphPulse(graph, {
      enabledEdges: enabledFlags(),
      inputPosition: { x: 0.02, y: 0.5 },
      baseDelay: state.baseDelay,
      distanceRatio: state.distanceRatio,
      timeCurve: state.timeCurve,
      nodePass: state.nodePass,
      feedback: state.feedback,
      pitchScale: state.turnPitchScale,
      horizonSeconds: 1_024,
      maxEvents: eventCap,
      maxFeedbackPasses: 24,
      maxDepth: MAX_GRAPH_EVENT_SCHEDULE,
      minAmplitude: MIN_GRAPH_EVENT_AMPLITUDE,
    });
    const maximum = instrumentMode === "drums"
      ? MAX_DRUM_EVENTS_PER_PULSE
      : MAX_SYNTH_EVENTS_PER_PULSE;
    const leaves = audibleLeafIds(graph);
    const markedEvents = scheduled.map((event) => ({
      ...event,
      audible: eventAudible(event, leaves),
    }));
    const coalesceOptions = {
      timeWindowSeconds: 0.006,
      maxEvents: maximum,
      key: (event) => [
        event.nodeId,
        Math.round((event.cumulativeSemitones ?? 0) * 100),
        event.kind,
        event.arrivalEdgeId ?? "entry",
        event.audible ? 1 : 0,
      ].join(":"),
    };
    const visualBase = coalesceGraphEvents(markedEvents, coalesceOptions);
    const audibleMarkedEvents = markedEvents.filter((event) => event.audible);
    const triggerEvents = coalesceGraphEvents(audibleMarkedEvents, coalesceOptions);
    const audioEvents = (instrumentMode === "synth" && state.articulation === "edge"
      ? markedEvents
        .filter((event) => (
          event.kind === "node"
          && event.arrivalEdgeId !== null
          && event.arrivalEdgeId !== undefined
          && (state.triggerScope !== "leaves" || leaves.has(event.nodeId))
        ))
        .map((event) => ({
          ...event,
          audible: true,
          audioStartOffset: event.departTime,
          gateSeconds: Math.max(0.004, event.time - event.departTime),
        }))
      : triggerEvents.map((event) => ({ ...event, audioStartOffset: event.time })))
      .sort((first, second) => (
        first.audioStartOffset - second.audioStartOffset
        || String(first.pathKey).localeCompare(String(second.pathKey))
      ))
      .slice(0, maximum);
    // Every sounded node must keep a matching route cue. Fill whatever visual
    // capacity remains with the earliest non-audible geometry events.
    const visualIdentity = (event) => [
      Math.round(event.time * 1_000_000),
      event.nodeId,
      event.kind,
      event.arrivalEdgeId ?? "entry",
    ].join(":");
    const priorityVisuals = audioEvents.map((event) => ({ ...event, audible: true }));
    const priorityKeys = new Set(priorityVisuals.map(visualIdentity));
    const visualFillers = visualBase.filter((event) => !priorityKeys.has(visualIdentity(event)));
    const events = [...priorityVisuals, ...visualFillers.slice(
      0,
      Math.max(0, maximum - priorityVisuals.length),
    )].sort((first, second) => (
      first.time - second.time
      || String(first.pathKey).localeCompare(String(second.pathKey))
    ));
    pulseTemplate = Object.freeze({
      graph,
      events: Object.freeze(events),
      audioEvents: Object.freeze(audioEvents),
      tailSeconds: scheduled.at(-1)?.time ?? 0,
      truncated: scheduled.length >= eventCap || events.length >= maximum,
      leafCount: leaves.size,
      reachedNodeCount: new Set(
        scheduled.filter((event) => event.kind === "node").map((event) => event.nodeId),
      ).size,
      feedbackEventCount: scheduled.filter((event) => (
        event.kind === "node" && event.feedbackCount > 0
      )).length,
      articulation: state.articulation,
      triggerScope: state.triggerScope,
    });
    return pulseTemplate;
  }

  function launchPulseAt(launchTime, {
    velocity = 1,
    rootFrequency = state.baseFrequency,
    seedMidi = state.seedNote,
    announce = true,
  } = {}) {
    const template = buildPulseTemplate();
    const safeSeedMidi = Math.round(clamp(seedMidi, 0, 127, 60));
    const run = {
      id: pulseSerial,
      launchTime,
      graph: template.graph,
      events: template.events,
      audioEvents: template.audioEvents,
      audioIndex: 0,
      visualIndex: 0,
      tailSeconds: template.tailSeconds,
      velocity: clamp(velocity, 0.05, 1, 1),
      rootFrequency,
      seedMidi: safeSeedMidi,
      seedOffset: safeSeedMidi - 60,
      articulation: template.articulation,
      triggerScope: template.triggerScope,
    };
    pulseSerial += 1;
    activeRuns.push(run);
    if (activeRuns.length > MAX_ACTIVE_RUNS) activeRuns = activeRuns.slice(-MAX_ACTIVE_RUNS);
    if (announce) {
      $("liveStatus").textContent = model.cyclic
        ? `Graph pulse launched. Cycle returns decay to ${percent(state.feedback)} each closing pass.`
        : "Graph pulse launched through a finite acyclic route.";
    }
    scheduleFrame();
    return run;
  }

  async function launchManualPulse() {
    await ensureAudio();
    return launchPulseAt((audio.context?.currentTime ?? 0) + 0.025);
  }

  async function launchSeedMidi(note, velocity = 0.9) {
    const midi = Math.round(clamp(note, 0, 127, 60));
    state.seedNote = midi;
    if (instrumentMode === "synth") state.baseFrequency = midiFrequency(midi);
    syncControls();
    await ensureAudio();
    return launchPulseAt((audio.context?.currentTime ?? 0) + 0.025, {
      velocity,
      rootFrequency: midiFrequency(midi),
      seedMidi: midi,
    });
  }

  async function ensureAudio() {
    clearError();
    if (audioRecoveryPromise) {
      const recovery = audioRecoveryPromise;
      await recovery;
      if (audioRecoveryPromise === recovery) audioRecoveryPromise = null;
    }
    let startedContext;
    try {
      startedContext = await audio.start();
      if (startedContext?.state && startedContext.state !== "running") {
        await startedContext.resume?.();
        if (startedContext.state !== "running") {
          const error = new Error("Audio output is still suspended. Try the sound trigger again.");
          if (startedContext.state === "closed") error.name = "InvalidStateError";
          throw error;
        }
      }
    } catch (error) {
      if (fatalAudioError(error)) engageFatalAudioProtection(error);
      throw error;
    }
    resetAudioProtection();
    const enteringAudioClock = audioClockContext !== audio.context;
    // Muted pulses use performance time; discard them before changing to the
    // unrelated AudioContext clock so they cannot linger far in the future.
    // Comparing the context after start also keeps two near-simultaneous first
    // keyboard gestures polyphonic: only the first continuation switches clocks.
    if (enteringAudioClock) activeRuns = [];
    audioClockContext = audio.context;
    state.audio = true;
    audio.setOutput(state.output);
    setPressed($("audioButton"), true);
    $("audioState").textContent = "on";
    if (enteringAudioClock) nextPulseTime = (audio.context?.currentTime ?? 0) + 0.035;
    updateUi();
  }

  async function stopAudio() {
    state.audio = false;
    activeRuns = [];
    nextPulseTime = null;
    resetAudioProtection();
    inFlightAudioTriggers.clear();
    setPressed($("audioButton"), false);
    $("audioState").textContent = "off";
    audioClockContext = null;
    await audio.close();
    updateUi();
  }

  function drumMapping(event, run) {
    const graph = run?.graph ?? displayModel ?? model;
    const voiceOffset = run?.seedOffset ?? 0;
    const voiceIndex = graphDrumVoiceIndex(event, graph, {
      mode: state.mappingMode,
      voiceOffset,
    });
    const mapped = mappedGraphDrumVoice(voices[voiceIndex], event, graph, {
      mappingMode: state.mappingMode,
      pitchDepth: state.pitchDepth,
      turnPitchDepth: state.turnPitchDepth,
      characterDepth: state.characterDepth,
      feedbackTone: state.feedbackTone,
      eventCount: event.pathCount ?? 1,
      voiceOffset,
    });
    return {
      voiceIndex,
      voice: graphDrumPercussionVoice(mapped, { style: state.percussionStyle }),
    };
  }

  function synthMapping(event, run) {
    return graphSynthVoice(event, run?.graph ?? displayModel ?? model, {
      mode: state.mappingMode,
      mappingMode: state.mappingMode,
      baseFrequency: run?.rootFrequency ?? state.baseFrequency,
      pitchRange: state.pitchRange,
      tuningMode: state.tuningMode,
      edoDivisions: state.edoDivisions,
      soundMode: state.soundMode,
      waveform: state.soundMode,
      modulationIndex: state.modulationIndex,
      modulationRatio: state.modulationRatio,
      stereoSpread: state.stereoSpread,
      spread: state.stereoSpread,
      feedbackTone: state.feedbackTone,
    });
  }

  function flashDrum(index) {
    const cell = $("drumMap")?.querySelector?.(`[data-voice-index="${index}"]`);
    if (!cell) return;
    cell.classList.add("is-active");
    runtime.setTimeout?.(() => cell.classList.remove("is-active"), 150);
  }

  function describeEvent(event, run) {
    if (instrumentMode === "drums") {
      const { voiceIndex, voice } = drumMapping({ ...event, amplitude: event.amplitude * run.velocity }, run);
      if (event.audible) flashDrum(voiceIndex);
      return `NODE ${event.nodeId + 1} · PASS ${event.feedbackCount} → ${voice.name.toUpperCase()} · ${percent(event.amplitude * run.velocity)}`;
    }
    const voice = synthMapping({ ...event, amplitude: event.amplitude * run.velocity }, run);
    return `NODE ${event.nodeId + 1} · PASS ${event.feedbackCount} → ${noteName(voice.frequency)} · ${percent(event.amplitude * run.velocity)}`;
  }

  function triggerAudioEvent(run, event, startAt) {
    const scaledEvent = {
      ...event,
      amplitude: event.amplitude * run.velocity,
    };
    if (instrumentMode === "drums") {
      const { voiceIndex, voice } = drumMapping(scaledEvent, run);
      const submitted = submitAudioTrigger(run, () => audio.trigger(voice, {
        startAt,
        graphRunId: run.id,
      }));
      if (submitted) flashDrum(voiceIndex);
      return submitted;
    }
    const voice = synthMapping(scaledEvent, run);
    return submitAudioTrigger(run, () => audio.trigger(voice, {
      startAt,
      graphRunId: run.id,
      attackSeconds: state.attack / 1_000,
      decaySeconds: state.decay / 1_000,
      gateSeconds: run.articulation === "edge"
        ? event.gateSeconds
        : state.noteDuration / 1_000,
      sustainLevel: state.sustain,
      releaseSeconds: state.release / 1_000,
    }));
  }

  function firstAudioEventAtOrAfter(events, offset, startIndex = 0) {
    let low = Math.max(0, startIndex);
    let high = events.length;
    while (low < high) {
      const middle = (low + high) >> 1;
      if (events[middle].audioStartOffset < offset) low = middle + 1;
      else high = middle;
    }
    return low;
  }

  function firstAudioEventAfter(events, offset, startIndex = 0) {
    let low = Math.max(0, startIndex);
    let high = events.length;
    while (low < high) {
      const middle = (low + high) >> 1;
      if (events[middle].audioStartOffset <= offset) low = middle + 1;
      else high = middle;
    }
    return low;
  }

  function audioAttackLimit() {
    return instrumentMode === "drums" && graphDrumStyleIsKarplus(state.percussionStyle)
      ? MAX_GRAPH_KARPLUS_ATTACKS_PER_FRAME
      : instrumentMode === "drums" && graphDrumStyleUsesPhysicalEngine(state.percussionStyle)
        ? MAX_GRAPH_PHYSICAL_ATTACKS_PER_FRAME
        : instrumentMode === "synth"
          ? MAX_GRAPH_SYNTH_ACTIVE_VOICES
          : MAX_AUDIO_ATTACKS_PER_FRAME;
  }

  function scheduleRunAudio(run, now, attackLimit) {
    if (!state.audio || !audio.context) return;
    const dueOffset = now + AUDIO_LOOKAHEAD_SECONDS - run.launchTime;
    const dueEnd = firstAudioEventAfter(run.audioEvents, dueOffset, run.audioIndex);
    if (dueEnd <= run.audioIndex) return;
    const onTimeOffset = now - 0.05 - run.launchTime;
    const onTimeIndex = Math.min(
      dueEnd,
      firstAudioEventAtOrAfter(run.audioEvents, onTimeOffset, run.audioIndex),
    );
    shedAudioEventCount += Math.max(0, onTimeIndex - run.audioIndex);
    run.audioIndex = onTimeIndex;

    const available = Math.max(0, Math.min(
      attackLimit - frameAttackCount,
      MAX_IN_FLIGHT_AUDIO_TRIGGERS - inFlightAudioTriggers.size,
    ));
    if (!audioSchedulingAvailable() || available === 0) {
      shedAudioEventCount += dueEnd - run.audioIndex;
      run.audioIndex = dueEnd;
      return;
    }

    const admittedEnd = Math.min(dueEnd, run.audioIndex + available);
    for (let index = run.audioIndex; index < admittedEnd; index += 1) {
      const event = run.audioEvents[index];
      const startAt = run.launchTime + event.audioStartOffset;
      if (triggerAudioEvent(run, event, Math.max(now, startAt))) frameAttackCount += 1;
      else shedAudioEventCount += 1;
    }
    shedAudioEventCount += dueEnd - admittedEnd;
    run.audioIndex = dueEnd;
  }

  function updateRunVisuals(run, now) {
    const elapsed = now - run.launchTime;
    while (
      run.visualIndex < run.events.length
      && run.events[run.visualIndex].time <= elapsed
    ) {
      latestEvent = { event: run.events[run.visualIndex], run };
      $("mappingReadout").textContent = describeEvent(latestEvent.event, run);
      run.visualIndex += 1;
    }
  }

  function updateClock(now) {
    if (!state.playing) return;
    const interval = graphPulseIntervalSeconds(state.tempo, state.pulseDivision);
    if (!Number.isFinite(nextPulseTime)) nextPulseTime = now + 0.035;
    let launches = 0;
    while (nextPulseTime <= now + AUDIO_LOOKAHEAD_SECONDS && launches < MAX_CLOCK_CATCH_UP) {
      launchPulseAt(nextPulseTime, { announce: false });
      nextPulseTime += interval;
      launches += 1;
    }
    if (launches === MAX_CLOCK_CATCH_UP && nextPulseTime < now) nextPulseTime = now + interval;
  }

  function point(node) {
    const visibleNode = displayModel?.nodes?.[node?.id] ?? node;
    const marginX = Math.max(44, cssWidth * 0.07);
    const marginY = Math.max(44, cssHeight * 0.08);
    return {
      x: marginX + clamp(visibleNode?.x, 0, 1, 0.5) * Math.max(1, cssWidth - marginX * 2),
      y: marginY + clamp(visibleNode?.y, 0, 1, 0.5) * Math.max(1, cssHeight - marginY * 2),
    };
  }

  function edgePoints(edge) {
    const from = point(displayModel.nodes[edge.from]);
    const to = point(displayModel.nodes[edge.to]);
    const reverse = reverseEdgeKeys.has(`${edge.from}>${edge.to}`);
    if (!reverse) return { from, to, offsetX: 0, offsetY: 0 };
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    const length = Math.max(1, Math.hypot(dx, dy));
    const sign = edge.from < edge.to ? 1 : -1;
    return {
      from,
      to,
      offsetX: -dy / length * 5 * sign,
      offsetY: dx / length * 5 * sign,
    };
  }

  function switchPosition(edge) {
    const { from, to, offsetX, offsetY } = edgePoints(edge);
    return {
      x: from.x + (to.x - from.x) * 0.54 + offsetX,
      y: from.y + (to.y - from.y) * 0.54 + offsetY,
    };
  }

  function nodeColor(nodeId) {
    if (instrumentMode === "drums") {
      const event = {
        nodeId,
        depth: nodeId,
        feedbackCount: 0,
        localTurn: 0,
        cumulativeTurn: 0,
        cumulativeSemitones: 0,
        amplitude: 1,
      };
      return voices[graphDrumVoiceIndex(event, model, { mode: state.mappingMode })]?.color ?? "#ffad69";
    }
    const hue = 195 + (nodeId * 37) % 150;
    return `hsl(${hue} 78% 70%)`;
  }

  function edgeControlsVisible() {
    return model.nodes.length <= MAX_GRAPH_INSTRUMENT_NODES && model.edges.length <= 192;
  }

  function drawEdge(edge) {
    const { from, to, offsetX, offsetY } = edgePoints(edge);
    const startX = from.x + offsetX;
    const startY = from.y + offsetY;
    const endX = to.x + offsetX;
    const endY = to.y + offsetY;
    const open = edgeEnabled(edge);
    context.save();
    context.globalAlpha = open ? 0.62 : 0.13;
    context.strokeStyle = edge.feedbackEdge ? "#ff826f" : "#55d9ff";
    context.lineWidth = edge.feedbackEdge ? 1.5 : 1;
    context.setLineDash(edge.feedbackEdge ? [5, 5] : []);
    context.beginPath();
    context.moveTo(startX, startY);
    context.lineTo(endX, endY);
    context.stroke();
    context.setLineDash([]);

    if (!edgeControlsVisible()) {
      context.restore();
      return;
    }
    const arrowAmount = 0.74;
    const ax = startX + (endX - startX) * arrowAmount;
    const ay = startY + (endY - startY) * arrowAmount;
    const angle = Math.atan2(endY - startY, endX - startX);
    context.fillStyle = edge.feedbackEdge ? "#ff826f" : "#5fe8c4";
    context.beginPath();
    context.moveTo(ax + Math.cos(angle) * 5, ay + Math.sin(angle) * 5);
    context.lineTo(ax + Math.cos(angle + 2.55) * 5, ay + Math.sin(angle + 2.55) * 5);
    context.lineTo(ax + Math.cos(angle - 2.55) * 5, ay + Math.sin(angle - 2.55) * 5);
    context.closePath();
    context.fill();

    const switchPoint = switchPosition(edge);
    context.translate(switchPoint.x, switchPoint.y);
    context.rotate(angle);
    context.fillStyle = "#071011";
    context.strokeStyle = edge.feedbackEdge ? "#ff826f" : open ? "#5fe8c4" : "#506064";
    context.lineWidth = hoveredEdgeId === edge.id ? 2.5 : 1.5;
    context.beginPath();
    context.rect(-5, -4, 10, 8);
    context.fill();
    context.stroke();
    if (!open) {
      context.beginPath();
      context.moveTo(-3, 3);
      context.lineTo(3, -3);
      context.stroke();
    }
    context.restore();
  }

  function drawDenseEdges() {
    const buckets = [[], [], [], []];
    for (const edge of model.edges) {
      const bucket = (edge.feedbackEdge ? 2 : 0) + (edgeEnabled(edge) ? 1 : 0);
      buckets[bucket].push(edge);
    }
    for (let bucket = 0; bucket < buckets.length; bucket += 1) {
      const edges = buckets[bucket];
      if (!edges.length) continue;
      const feedbackEdge = bucket >= 2;
      const open = bucket % 2 === 1;
      context.save();
      context.globalAlpha = open ? 0.62 : 0.13;
      context.strokeStyle = feedbackEdge ? "#ff826f" : "#55d9ff";
      context.lineWidth = feedbackEdge ? 1.5 : 1;
      context.setLineDash(feedbackEdge ? [5, 5] : []);
      context.beginPath();
      for (const edge of edges) {
        const { from, to, offsetX, offsetY } = edgePoints(edge);
        context.moveTo(from.x + offsetX, from.y + offsetY);
        context.lineTo(to.x + offsetX, to.y + offsetY);
      }
      context.stroke();
      context.setLineDash([]);
      context.restore();
    }
  }

  function drawNode(node, pulseLevel = 0) {
    const position = point(node);
    const color = nodeColor(node.id);
    const radius = model.nodes.length > 96 ? 4 : 8;
    const selectedRadius = Math.max(radius + 2, 6);
    context.save();
    context.shadowColor = color;
    context.shadowBlur = model.nodes.length > 96 ? 0 : selectedNodeId === node.id ? 18 : 8;
    context.fillStyle = "#071011";
    context.strokeStyle = color;
    context.lineWidth = selectedNodeId === node.id ? 2.5 : 1.25;
    context.beginPath();
    context.arc(position.x, position.y, selectedNodeId === node.id ? selectedRadius : radius, 0, TAU);
    context.fill();
    if (pulseLevel > 0) {
      context.globalAlpha = clamp(pulseLevel, 0, 1, 0);
      context.fillStyle = color;
      context.fill();
      context.globalAlpha = 1;
    }
    context.stroke();
    context.shadowBlur = 0;
    if (model.nodes.length <= 96 || selectedNodeId === node.id) {
      context.fillStyle = color;
      context.font = "7px ui-monospace, SFMono-Regular, Menlo, monospace";
      context.textAlign = "center";
      context.textBaseline = "middle";
      context.fillText(String(node.id + 1), position.x, position.y + 0.5);
    }
    context.restore();
  }

  function drawPulseEvent(run, event, elapsed, nodeFlashes) {
    const amplitude = clamp(event.amplitude * run.velocity, 0, 1, 0);
    const color = event.feedbackCount > 0 ? "#ff826f" : instrumentMode === "drums" ? "#ffad69" : "#b299ff";
    if (
      event.kind === "node"
      && event.arrivalEdgeId !== null
      && event.arrivalEdgeId !== undefined
    ) {
      const edge = model.edges[event.arrivalEdgeId];
      if (edge && elapsed >= event.departTime && elapsed <= event.time) {
        const { from, to, offsetX, offsetY } = edgePoints(edge);
        context.save();
        context.globalAlpha = 0.12 + amplitude * 0.42;
        context.strokeStyle = color;
        context.lineWidth = 1 + amplitude * 2;
        context.beginPath();
        context.moveTo(from.x + offsetX, from.y + offsetY);
        context.lineTo(to.x + offsetX, to.y + offsetY);
        context.stroke();
        context.restore();
      }
    }
    const age = elapsed - event.time;
    if (age < 0 || age > 0.14) return;
    const node = displayModel.nodes[event.nodeId];
    if (!node) return;
    const fade = 1 - age / 0.14;
    const level = fade * (0.25 + amplitude * 0.65);
    nodeFlashes.set(event.nodeId, Math.max(nodeFlashes.get(event.nodeId) ?? 0, level));
  }

  function draw(now) {
    context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
    context.clearRect(0, 0, cssWidth, cssHeight);
    if (edgeControlsVisible()) {
      for (const edge of model.edges) drawEdge(edge);
    } else {
      drawDenseEdges();
    }
    const nodeFlashes = new Map();
    for (const run of activeRuns.slice(-MAX_VISIBLE_RUNS)) {
      const elapsed = now - run.launchTime;
      for (const event of run.events) {
        if (event.departTime > elapsed || event.time < elapsed - 0.22) continue;
        drawPulseEvent(run, event, elapsed, nodeFlashes);
      }
    }
    for (const node of model.nodes) drawNode(node, nodeFlashes.get(node.id));
    const input = { x: 18, y: cssHeight * 0.5 };
    context.save();
    context.fillStyle = instrumentMode === "drums" ? "#ffad69" : "#b299ff";
    context.beginPath();
    context.moveTo(input.x - 6, input.y);
    context.lineTo(input.x + 5, input.y - 6);
    context.lineTo(input.x + 5, input.y + 6);
    context.closePath();
    context.fill();
    context.restore();
  }

  function frame(frameTime) {
    scheduledFrame = 0;
    if (disposed) return;
    const safeFrameTime = Number.isFinite(frameTime) ? frameTime : runtime.performance?.now?.() ?? lastFrameTime;
    const delta = Math.min(0.1, Math.max(0, (safeFrameTime - lastFrameTime) / 1_000));
    lastFrameTime = safeFrameTime;
    if (advanceNodeMotion(delta)) {
      displayModel = geometryModel();
      if (safeFrameTime - lastMotionTemplateTime >= motionTemplateIntervalMs) {
        const buildStartedAt = performanceNow();
        pulseTemplate = null;
        refreshActiveRunGeometry(displayModel, { retime: true });
        const buildDuration = Math.max(0, performanceNow() - buildStartedAt);
        motionTemplateIntervalMs = clamp(
          Math.max(
            MIN_MOTION_TEMPLATE_INTERVAL_MS,
            buildDuration * MOTION_TEMPLATE_COST_MULTIPLIER,
          ),
          MIN_MOTION_TEMPLATE_INTERVAL_MS,
          MAX_MOTION_TEMPLATE_INTERVAL_MS,
          MIN_MOTION_TEMPLATE_INTERVAL_MS,
        );
        motionTemplateBuildCount += 1;
        lastMotionTemplateTime = safeFrameTime;
      }
    } else {
      displayModel = model;
    }
    const now = timelineNow(safeFrameTime);
    updateClock(now);
    frameAttackCount = 0;
    const attackLimit = audioAttackLimit();
    // Fresh manual and MIDI graph notes get first claim on bounded Web Audio
    // capacity, so an older dense tail cannot make a new gesture inaudible.
    for (let index = activeRuns.length - 1; index >= 0; index -= 1) {
      scheduleRunAudio(activeRuns[index], now, attackLimit);
    }
    for (const run of activeRuns) {
      updateRunVisuals(run, now);
    }
    activeRuns = activeRuns.filter((run) => now <= run.launchTime + run.tailSeconds + 0.36);
    draw(now);
    const preset = GRAPH_PRESETS[model.type];
    const activePulseCount = activeRuns.length;
    const audioLabel = audioProtectionActive()
      ? "PROTECTED"
      : state.audio
        ? "ON"
        : "OFF";
    const safetyLabel = shedAudioEventCount > 0
      ? ` · ${shedAudioEventCount} ATTACK${shedAudioEventCount === 1 ? "" : "S"} THINNED`
      : "";
    $("stageReadout").textContent = `${preset.label.toUpperCase()} · ${model.nodes.length} NODES · ${activePulseCount} PULSE${activePulseCount === 1 ? "" : "S"} · AUDIO ${audioLabel}${safetyLabel}`;
    if (state.playing || state.nodeMoving || activeRuns.length || draggingNodeId !== null) scheduleFrame();
  }

  function resizeCanvas() {
    const bounds = stageWrap.getBoundingClientRect();
    cssWidth = Math.max(1, Math.round(bounds.width));
    cssHeight = Math.max(1, Math.round(bounds.height));
    pixelRatio = Math.max(1, Math.min(
      runtime.devicePixelRatio || 1,
      2,
      Math.sqrt(3_000_000 / Math.max(1, cssWidth * cssHeight)),
    ));
    canvas.width = Math.round(cssWidth * pixelRatio);
    canvas.height = Math.round(cssHeight * pixelRatio);
    scheduleFrame();
  }

  function renderDrumMap() {
    const drumMap = $("drumMap");
    if (!drumMap) return;
    drumMap.dataset.mappingMode = state.mappingMode;
    drumMap.dataset.percussionStyle = state.percussionStyle;
    drumMap.innerHTML = voices.map((voice, index) => {
      const styled = graphDrumPercussionVoice(
        { ...voice, voiceIndex: index },
        { style: state.percussionStyle },
      );
      return `<button class="l-system-drum-cell" type="button" data-voice-index="${index}" data-voice-id="${voice.id}" style="--voice-color: ${voice.color}"><b>${styled.name}</b><small>${voice.key.toUpperCase()} · ${styled.family}</small></button>`;
    }).join("");
    for (const button of drumMap.querySelectorAll(".l-system-drum-cell")) {
      button.addEventListener("click", async () => {
        try {
          await ensureAudio();
          const index = Number(button.dataset.voiceIndex) || 0;
          await audio.trigger(graphDrumPercussionVoice(
            { ...voices[index], voiceIndex: index },
            { style: state.percussionStyle },
          ));
          flashDrum(index);
        } catch (error) {
          showError(error);
        }
      });
    }
  }

  function mappingDetails() {
    return instrumentMode === "drums"
      ? DRUM_MAPPING_DETAILS[state.mappingMode] ?? DRUM_MAPPING_DETAILS["position-grid"]
      : SYNTH_MAPPING_DETAILS[state.mappingMode] ?? SYNTH_MAPPING_DETAILS.turn;
  }

  function updateMappingUi() {
    const details = mappingDetails();
    $("mappingDescription").textContent = details.description;
    details.legend.forEach(([label, detail], index) => {
      $("mappingLegendLabel" + index).textContent = label;
      $("mappingLegendDetail" + index).textContent = detail;
    });
    if (instrumentMode === "drums") {
      const style = GRAPH_DRUM_PERCUSSION_STYLES.find(({ id }) => id === state.percussionStyle)
        ?? GRAPH_DRUM_PERCUSSION_STYLES[0];
      $("mappingSummary").textContent = `${details.label} · ${style.label.toLowerCase()}`;
    } else {
      const tuning = state.tuningMode === "pure"
        ? "pure angle"
        : state.tuningMode === "just"
          ? "just ratios"
          : `${Math.round(state.edoDivisions)} equal divisions`;
      $("mappingSummary").textContent = `${details.label} · ${tuning}`;
    }
  }

  function updateUi() {
    const topology = GRAPH_PRESETS[model.type] ?? GRAPH_PRESETS.dag;
    const patch = GRAPH_INSTRUMENT_PATCHES[state.graphPatch];
    const openEdges = model.edges.filter(edgeEnabled).length;
    const feedbackEdges = model.edges.filter((edge) => edge.feedbackEdge).length;
    const parameters = edgeAudioParameters(model, state);
    const delaySeconds = parameters.map(({ delaySeconds: value }) => value);
    const minimumDelay = (delaySeconds.length ? Math.min(...delaySeconds) : 0) * 1_000;
    const maximumDelay = (delaySeconds.length ? Math.max(...delaySeconds) : 0) * 1_000;
    const template = buildPulseTemplate();

    setPressed($("playButton"), state.playing);
    setPressed($("audioButton"), state.audio);
    $("audioState").textContent = state.audio ? "on" : "off";
    $("playSummary").textContent = `${state.playing ? "playing" : "paused"} · ${Math.round(state.tempo)} BPM · ${state.pulseDivision === 0.5 ? "1/2" : state.pulseDivision} beat${state.pulseDivision === 1 ? "" : "s"}`;
    $("topologySummary").textContent = `${patch?.label ?? "Custom"} · ${topology.label}`;
    $("topologyDescription").textContent = topology.description;
    $("graphPatchDescription").textContent = patch?.instrumentDescription ?? patch?.description ?? topology.description;
    $("delaySummary").textContent = `${Math.round(minimumDelay)}–${Math.round(maximumDelay)} ms · ${model.cyclic ? `${percent(state.feedback)} return` : "acyclic"}`;
    $("feedback").disabled = !model.cyclic;
    $("feedbackTone").disabled = !model.cyclic;
    $("feedbackSafetyNote").textContent = model.cyclic
      ? `Cyclic · each closing pass retains at most ${percent(state.feedback)} amplitude and ${percent(state.feedbackTone)} tone.`
      : "Acyclic · the feedback controls are dormant.";
    $("graphInfoSummary").textContent = `${model.nodes.length} nodes · ${model.edges.length} routes`;
    $("structureReadout").textContent = `${model.nodes.length} nodes · ${openEdges}/${model.edges.length} routes open`;
    $("cycleReadout").textContent = model.cyclic
      ? `${feedbackEdges} cycle-closing edge${feedbackEdges === 1 ? "" : "s"} · bounded`
      : "none · finite tail";
    $("tailReadout").textContent = `${template.tailSeconds.toFixed(2)} s · ${template.feedbackEventCount} decayed return${template.feedbackEventCount === 1 ? "" : "s"} · ${template.leafCount} leaf${template.leafCount === 1 ? "" : "s"} · ${template.reachedNodeCount}/${model.nodes.length} reached${template.truncated ? " · capped" : ""}`;
    const selected = model.nodes[selectedNodeId] ?? model.nodes[0];
    const indegree = model.indegree[selected.id] ?? 0;
    const outdegree = model.outdegree[selected.id] ?? 0;
    $("selectedNodeReadout").textContent = `node ${selected.id + 1} · ${indegree} in / ${outdegree} out`;
    $("openAllSwitchesButton").disabled = openEdges === model.edges.length;
    for (const button of $("graphPatchGrid")?.querySelectorAll?.("[data-graph-patch]") ?? []) {
      setPressed(button, button.dataset.graphPatch === state.graphPatch);
    }
    updateMappingUi();
    setPressed($("nodeMotionPlayButton"), state.nodeMoving);
    $("motionSummary").textContent = state.nodeMoving
      ? `${state.nodeMotionMode} · ${state.nodeMotionSpeed.toFixed(2)} cyc/s`
      : "nodes stable";
    if ($("edoDivisions")) $("edoDivisions").disabled = state.tuningMode !== "equal";
    if ($("noteDuration")) $("noteDuration").disabled = state.articulation === "edge";
    if (instrumentMode === "synth") {
      $("soundSummary").textContent = `${state.soundMode.toUpperCase()} · ${state.articulation === "edge" ? "edge gate" : `${Math.round(state.noteDuration)} ms`} · ADSR`;
    }
    canvas.setAttribute("aria-label", `${topology.label}, ${model.nodes.length} nodes and ${openEdges} of ${model.edges.length} directed routes open. ${model.cyclic ? `Cyclic note feedback retains ${percent(state.feedback)} amplitude per closing pass.` : "Acyclic finite traversal."} Audio ${state.audio ? "on" : "off"}.`);
    scheduleFrame();
  }

  function rebuildModel({ silence = true } = {}) {
    state.nodeCount = Math.round(clamp(state.nodeCount, 3, MAX_GRAPH_INSTRUMENT_NODES, 10));
    $("nodeCount").value = String(state.nodeCount);
    model = generateGraph({
      type: state.topology,
      nodeCount: state.nodeCount,
      density: state.density,
      seed: state.seed,
      maxNodes: MAX_GRAPH_INSTRUMENT_NODES,
    });
    displayModel = model;
    reverseEdgeKeys = new Set(model.edges.map((edge) => `${edge.to}>${edge.from}`));
    edgeSwitchStates = new Map(model.edges.map((edge) => [edgeKey(edge), true]));
    resetNodeWalkState();
    selectedNodeId = Math.min(selectedNodeId, model.nodes.length - 1);
    invalidatePulseTemplate({ clearRuns: true, silence: silence && state.audio });
    updateUi();
  }

  function syncControls() {
    for (const [id, value] of Object.entries({
      graphPatch: state.graphPatch,
      topology: state.topology,
      nodeCount: state.nodeCount,
      density: state.density,
      seed: state.seed,
      tempo: state.tempo,
      pulseDivision: state.pulseDivision,
      triggerScope: state.triggerScope,
      seedNote: state.seedNote,
      output: state.output,
      nodePass: state.nodePass,
      baseDelay: state.baseDelay,
      distanceRatio: state.distanceRatio,
      timeCurve: state.timeCurve,
      feedback: state.feedback,
      feedbackTone: state.feedbackTone,
      nodeMotionMode: state.nodeMotionMode,
      nodeMotionSpeed: state.nodeMotionSpeed,
      nodeMotionAmount: state.nodeMotionAmount,
      mappingMode: state.mappingMode,
      percussionStyle: state.percussionStyle,
      pitchDepth: state.pitchDepth,
      turnPitchDepth: state.turnPitchDepth,
      characterDepth: state.characterDepth,
      baseFrequency: state.baseFrequency,
      pitchRange: state.pitchRange,
      tuningMode: state.tuningMode,
      edoDivisions: state.edoDivisions,
      turnPitchScale: state.turnPitchScale,
      soundMode: state.soundMode,
      modulationIndex: state.modulationIndex,
      modulationRatio: state.modulationRatio,
      articulation: state.articulation,
      noteDuration: state.noteDuration,
      attack: state.attack,
      decay: state.decay,
      sustain: state.sustain,
      release: state.release,
      stereoSpread: state.stereoSpread,
    })) {
      if ($(id)) $(id).value = String(value);
    }
    paintOutputs();
  }

  function paintOutputs() {
    const formats = {
      nodeCount: (value) => String(Math.round(value)),
      density: percent,
      seed: (value) => String(Math.round(value)),
      seedNote: (value) => {
        const midi = Math.round(clamp(value, 0, 127, 60));
        return `${noteName(midiFrequency(midi))} · ${midi}`;
      },
      tempo: (value) => `${Math.round(value)} BPM`,
      output: percent,
      nodePass: percent,
      baseDelay: (value) => `${Math.round(value)} ms`,
      distanceRatio: (value) => `${Number(value).toFixed(2)}×`,
      timeCurve: (value) => Number(value).toFixed(2),
      feedback: percent,
      feedbackTone: percent,
      nodeMotionSpeed: (value) => `${Number(value).toFixed(2)} cyc/s`,
      nodeMotionAmount: percent,
      pitchDepth: (value) => `${Math.round(value)} st`,
      turnPitchDepth: (value) => `${Math.round(value)} st`,
      characterDepth: percent,
      baseFrequency: (value) => `${Math.round(value)} Hz`,
      pitchRange: (value) => `${Number(value).toFixed(2)} oct`,
      edoDivisions: (value) => String(Math.round(value)),
      turnPitchScale: (value) => `${Number(value).toFixed(2)} oct / 180°`,
      modulationIndex: (value) => Number(value).toFixed(2),
      modulationRatio: (value) => `${Number(value).toFixed(2)}×`,
      noteDuration: (value) => `${Math.round(value)} ms`,
      attack: (value) => `${Math.round(value)} ms`,
      decay: (value) => `${Math.round(value)} ms`,
      sustain: percent,
      release: (value) => `${Math.round(value)} ms`,
      stereoSpread: percent,
    };
    for (const [id, formatter] of Object.entries(formats)) {
      const output = $(`${id}Out`);
      if (output) output.textContent = formatter(state[id]);
    }
  }

  function markCustom() {
    state.graphPatch = "";
    if ($("graphPatch")) $("graphPatch").value = "custom";
  }

  function loadPatch(name) {
    const patch = GRAPH_INSTRUMENT_PATCHES[name];
    const presetState = graphInstrumentPresetState(name, instrumentMode);
    if (!patch || !presetState) return;
    Object.assign(state, presetState);
    syncControls();
    rebuildModel();
    if (instrumentMode === "drums") renderDrumMap();
    $("liveStatus").textContent = instrumentMode === "drums"
      ? `${patch.label} graph, timing, mapping, and sound preset loaded. ${GRAPH_PRESETS[state.topology].description}`
      : `${patch.label} graph and timing preset loaded; synth controls preserved. ${GRAPH_PRESETS[state.topology].description}`;
  }

  function randomGraphUnit() {
    const values = new Uint32Array(1);
    try {
      if (typeof runtime.crypto?.getRandomValues === "function") {
        runtime.crypto.getRandomValues(values);
        return values[0] / 0x1_0000_0000;
      }
    } catch {
      // Sandboxed and test runtimes can fall back to their local random source.
    }
    return clamp(runtime.Math?.random?.() ?? Math.random(), 0, 1, 0.5);
  }

  function randomGraphInteger(minimum, maximum) {
    return minimum + Math.floor(randomGraphUnit() * (maximum - minimum + 1));
  }

  function randomizeGraph() {
    const topologyIds = Object.keys(GRAPH_PRESETS);
    state.topology = topologyIds[randomGraphInteger(0, topologyIds.length - 1)] ?? "random";
    // Bias toward nimble graphs while keeping the full 32-node range
    // discoverable from the one-click randomizer.
    state.nodeCount = Math.round(
      6 + randomGraphUnit() ** 1.7 * (MAX_GRAPH_INSTRUMENT_NODES - 6),
    );
    state.density = Math.round((0.18 + randomGraphUnit() * 0.46) * 100) / 100;
    const seedOffset = randomGraphInteger(1, 98);
    state.seed = ((Math.round(state.seed) - 1 + seedOffset) % 99) + 1;
    markCustom();
    syncControls();
    $("liveStatus").textContent = `Random ${GRAPH_PRESETS[state.topology].label.toLowerCase()} graph: ${state.nodeCount} nodes, seed ${state.seed}.`;
    rebuildModel();
  }

  function firstFutureVisualIndex(events, elapsed) {
    let low = 0;
    let high = events.length;
    while (low < high) {
      const middle = (low + high) >> 1;
      if (events[middle].time <= elapsed) low = middle + 1;
      else high = middle;
    }
    return low;
  }

  function eventPathKeys(event) {
    if (Array.isArray(event?.pathKeys)) return event.pathKeys;
    return event?.pathKey ? [event.pathKey] : [];
  }

  function refreshActiveRunGeometry(graph = displayModel, { retime = false } = {}) {
    if (!retime || !activeRuns.length) {
      for (const run of activeRuns) run.graph = graph;
      return;
    }
    const template = buildPulseTemplate();
    const now = timelineNow(runtime.performance?.now?.() ?? 0);
    for (const run of activeRuns) {
      run.graph = template.graph;
      // Articulation and attack scope are launch policies. A later policy edit
      // must not reinterpret already-running events when geometry moves again.
      if (
        run.articulation !== template.articulation
        || run.triggerScope !== template.triggerScope
      ) continue;
      const elapsed = Math.max(0, now - run.launchTime);
      const retainedAudio = run.audioEvents.slice(0, run.audioIndex);
      const alreadyScheduledPaths = new Set(
        retainedAudio.flatMap((event) => eventPathKeys(event)),
      );
      const safeFuture = template.audioEvents.filter((event) => (
        event.audioStartOffset > elapsed + AUDIO_LOOKAHEAD_SECONDS
        && !eventPathKeys(event).some((key) => alreadyScheduledPaths.has(key))
      ));
      run.audioEvents = [...retainedAudio, ...safeFuture];
      run.audioIndex = retainedAudio.length;
      run.events = template.events;
      run.visualIndex = firstFutureVisualIndex(template.events, elapsed);
      run.tailSeconds = template.tailSeconds;
    }
  }

  function arrangeGraph() {
    const arranged = generateGraph({
      type: state.topology,
      nodeCount: state.nodeCount,
      density: state.density,
      seed: state.seed,
      maxNodes: MAX_GRAPH_INSTRUMENT_NODES,
    });
    model.nodes.forEach((node, index) => {
      node.x = arranged.nodes[index]?.x ?? node.x;
      node.y = arranged.nodes[index]?.y ?? node.y;
    });
    state.nodeMoving = false;
    state.nodeMotionPhase = 0;
    displayModel = model;
    resetNodeWalkState();
    markCustom();
    invalidatePulseTemplate({ clearRuns: false });
    refreshActiveRunGeometry(model, { retime: true });
    syncControls();
    updateUi();
    $("liveStatus").textContent = "Canonical symmetric layout restored without launching a new pulse.";
  }

  function scatterGraph() {
    for (const node of model.nodes) {
      node.x = clamp(node.x + (randomGraphUnit() * 2 - 1) * 0.22, 0.02, 0.98, node.x);
      node.y = clamp(node.y + (randomGraphUnit() * 2 - 1) * 0.22, 0.02, 0.98, node.y);
    }
    displayModel = model;
    resetNodeWalkState();
    markCustom();
    invalidatePulseTemplate({ clearRuns: false });
    refreshActiveRunGeometry(model, { retime: true });
    updateUi();
    $("liveStatus").textContent = "Node positions scattered; connectivity and transport phase were preserved.";
  }

  function bindRange(id, key, {
    rebuild = false,
    template = false,
    custom = false,
    after,
  } = {}) {
    const input = $(id);
    if (!input) return;
    input.addEventListener("input", () => {
      state[key] = Number(input.value);
      if (rebuild) {
        markCustom();
        rebuildModel();
      } else {
        if (template || custom) markCustom();
        if (template) {
          invalidatePulseTemplate({ clearRuns: false, silence: false });
          refreshActiveRunGeometry(displayModel, { retime: true });
        }
      }
      if (key === "output") audio.setOutput(state.output);
      paintOutputs();
      after?.();
      updateUi();
    });
  }

  bindRange("nodeCount", "nodeCount", { rebuild: true });
  bindRange("density", "density", { rebuild: true });
  bindRange("seed", "seed", { rebuild: true });
  bindRange("seedNote", "seedNote", {
    after: () => {
      state.seedNote = Math.round(clamp(state.seedNote, 0, 127, 60));
      $("seedNote").value = String(state.seedNote);
      if (instrumentMode === "synth") state.baseFrequency = midiFrequency(state.seedNote);
    },
  });
  bindRange("tempo", "tempo", { custom: true });
  bindRange("output", "output");
  bindRange("nodePass", "nodePass", { template: true });
  bindRange("baseDelay", "baseDelay", { template: true });
  bindRange("distanceRatio", "distanceRatio", { template: true });
  bindRange("timeCurve", "timeCurve", { template: true });
  bindRange("feedback", "feedback", { template: true });
  bindRange("feedbackTone", "feedbackTone", { custom: true });
  bindRange("nodeMotionSpeed", "nodeMotionSpeed", { custom: true });
  bindRange("nodeMotionAmount", "nodeMotionAmount", { custom: true });
  bindRange("pitchDepth", "pitchDepth", { custom: true });
  bindRange("turnPitchDepth", "turnPitchDepth", { custom: true });
  bindRange("characterDepth", "characterDepth", { custom: true });
  bindRange("pitchRange", "pitchRange", { custom: true });
  bindRange("edoDivisions", "edoDivisions", { custom: true });
  bindRange("turnPitchScale", "turnPitchScale", { template: true });
  bindRange("modulationIndex", "modulationIndex", { custom: true });
  bindRange("modulationRatio", "modulationRatio", { custom: true });
  bindRange("noteDuration", "noteDuration", { custom: true });
  bindRange("attack", "attack", { custom: true });
  bindRange("decay", "decay", { custom: true });
  bindRange("sustain", "sustain", { custom: true });
  bindRange("release", "release", { custom: true });
  bindRange("stereoSpread", "stereoSpread", { custom: true });

  $("topology").addEventListener("change", (event) => {
    state.topology = GRAPH_PRESETS[event.currentTarget.value] ? event.currentTarget.value : "dag";
    markCustom();
    rebuildModel();
  });
  $("pulseDivision").addEventListener("change", (event) => {
    state.pulseDivision = clamp(event.currentTarget.value, 0.5, 4, 1);
    markCustom();
    updateUi();
  });
  $("triggerScope").addEventListener("change", (event) => {
    const requestedScope = ["all", "leaves"].includes(event.currentTarget.value)
      ? event.currentTarget.value
      : "all";
    state.triggerScope = requestedScope;
    markCustom();
    invalidatePulseTemplate({ clearRuns: false });
    updateUi();
  });
  $("mappingMode").addEventListener("change", (event) => {
    state.mappingMode = event.currentTarget.value;
    markCustom();
    if (instrumentMode === "drums") renderDrumMap();
    updateMappingUi();
    scheduleFrame();
  });
  $("percussionStyle")?.addEventListener("change", (event) => {
    state.percussionStyle = sanitizeGraphDrumPercussionStyle(event.currentTarget.value);
    event.currentTarget.value = state.percussionStyle;
    markCustom();
    renderDrumMap();
    updateUi();
  });
  $("tuningMode")?.addEventListener("change", (event) => {
    state.tuningMode = ["pure", "equal", "just"].includes(event.currentTarget.value)
      ? event.currentTarget.value
      : "equal";
    markCustom();
    updateUi();
  });
  $("soundMode")?.addEventListener("change", (event) => {
    state.soundMode = event.currentTarget.value;
    markCustom();
    updateUi();
  });
  $("articulation")?.addEventListener("change", (event) => {
    state.articulation = event.currentTarget.value === "edge" ? "edge" : "trigger";
    markCustom();
    invalidatePulseTemplate({ clearRuns: false });
    updateUi();
  });
  $("nodeMotionMode").addEventListener("change", (event) => {
    state.nodeMotionMode = ["wiggle", "orbit", "random"].includes(event.currentTarget.value)
      ? event.currentTarget.value
      : "wiggle";
    state.nodeMotionPhase = 0;
    resetNodeWalkState();
    markCustom();
    updateUi();
  });

  for (const button of $("graphPatchGrid")?.querySelectorAll?.("[data-graph-patch]") ?? []) {
    button.addEventListener("click", () => loadPatch(button.dataset.graphPatch));
  }
  $("newGraphButton").addEventListener("click", () => {
    state.seed = state.seed >= 99 ? 1 : Math.round(state.seed) + 1;
    markCustom();
    syncControls();
    rebuildModel();
  });
  $("randomGraphButton").addEventListener("click", randomizeGraph);
  $("arrangeGraphButton").addEventListener("click", arrangeGraph);
  $("scatterGraphButton").addEventListener("click", scatterGraph);
  $("nodeMotionPlayButton").addEventListener("click", () => {
    if (reducedMotionQuery?.matches) {
      state.nodeMoving = false;
      $("liveStatus").textContent = "Node motion remains paused because reduced motion is enabled.";
      updateUi();
      return;
    }
    state.nodeMoving = !state.nodeMoving;
    if (state.nodeMoving) {
      resetNodeWalkState();
      lastMotionTemplateTime = -Infinity;
    } else {
      displayModel = model;
      invalidatePulseTemplate({ clearRuns: false });
      refreshActiveRunGeometry(model, { retime: true });
    }
    markCustom();
    updateUi();
  });
  $("openAllSwitchesButton").addEventListener("click", () => {
    edgeSwitchStates = new Map(model.edges.map((edge) => [edgeKey(edge), true]));
    invalidatePulseTemplate({ clearRuns: false, silence: false });
    refreshActiveRunGeometry(displayModel, { retime: true });
    $("liveStatus").textContent = "Every graph route opened.";
    updateUi();
  });
  $("playButton").addEventListener("click", async () => {
    try {
      const willPlay = !state.playing;
      if (willPlay) await ensureAudio();
      state.playing = willPlay;
      nextPulseTime = null;
      setPressed($("playButton"), state.playing);
      updateUi();
    } catch (error) {
      showError(error);
    }
  });
  $("pulseButton").addEventListener("click", () => launchManualPulse().catch(showError));
  $("audioButton").addEventListener("click", async () => {
    try {
      if (state.audio) await stopAudio();
      else await ensureAudio();
    } catch (error) {
      state.audio = false;
      setPressed($("audioButton"), false);
      $("audioState").textContent = "off";
      showError(error);
    }
  });

  function canvasPosition(event) {
    const bounds = canvas.getBoundingClientRect();
    return {
      x: event.clientX - bounds.left,
      y: event.clientY - bounds.top,
    };
  }

  function nodeAt(position) {
    let best = null;
    let bestDistance = NODE_HIT_RADIUS;
    for (const node of model.nodes) {
      const location = point(node);
      const distance = Math.hypot(position.x - location.x, position.y - location.y);
      if (distance <= bestDistance) {
        best = node;
        bestDistance = distance;
      }
    }
    return best;
  }

  function edgeAt(position) {
    if (!edgeControlsVisible()) return null;
    let best = null;
    let bestDistance = EDGE_SWITCH_HIT_RADIUS;
    for (const edge of model.edges) {
      const location = switchPosition(edge);
      const distance = Math.hypot(position.x - location.x, position.y - location.y);
      if (distance <= bestDistance) {
        best = edge;
        bestDistance = distance;
      }
    }
    return best;
  }

  canvas.addEventListener("pointerdown", (event) => {
    const position = canvasPosition(event);
    const selected = nodeAt(position);
    if (!selected) {
      const switchedEdge = edgeAt(position);
      if (!switchedEdge) return;
      const enabled = !edgeEnabled(switchedEdge);
      edgeSwitchStates.set(edgeKey(switchedEdge), enabled);
      invalidatePulseTemplate({ clearRuns: false, silence: false });
      refreshActiveRunGeometry(displayModel, { retime: true });
      $("liveStatus").textContent = `Route ${switchedEdge.from + 1} → ${switchedEdge.to + 1} ${enabled ? "opened" : "closed"}.`;
      updateUi();
      event.preventDefault();
      return;
    }
    if (state.nodeMoving) {
      model.nodes.forEach((node, index) => {
        node.x = displayModel.nodes[index]?.x ?? node.x;
        node.y = displayModel.nodes[index]?.y ?? node.y;
      });
      state.nodeMoving = false;
      displayModel = model;
      resetNodeWalkState();
    }
    selectedNodeId = selected.id;
    draggingNodeId = selected.id;
    canvas.classList.add("is-dragging");
    canvas.setPointerCapture?.(event.pointerId);
    updateUi();
    event.preventDefault();
  });

  canvas.addEventListener("pointermove", (event) => {
    const position = canvasPosition(event);
    if (draggingNodeId !== null) {
      const marginX = Math.max(44, cssWidth * 0.07);
      const marginY = Math.max(44, cssHeight * 0.08);
      const node = model.nodes[draggingNodeId];
      node.x = clamp((position.x - marginX) / Math.max(1, cssWidth - marginX * 2), 0.02, 0.98, node.x);
      node.y = clamp((position.y - marginY) / Math.max(1, cssHeight - marginY * 2), 0.02, 0.98, node.y);
      displayModel = model;
      markCustom();
      invalidatePulseTemplate({ clearRuns: false, silence: false });
      refreshActiveRunGeometry(model, { retime: true });
      updateUi();
      event.preventDefault();
      return;
    }
    hoveredEdgeId = edgeAt(position)?.id ?? null;
    canvas.classList.toggle("is-switch-hover", hoveredEdgeId !== null);
    scheduleFrame();
  });

  const finishDrag = (event) => {
    if (draggingNodeId === null) return;
    draggingNodeId = null;
    canvas.classList.remove("is-dragging");
    canvas.releasePointerCapture?.(event.pointerId);
    $("liveStatus").textContent = `Node ${selectedNodeId + 1} moved; connected edge times were recalculated.`;
    updateUi();
  };
  canvas.addEventListener("pointerup", finishDrag);
  canvas.addEventListener("pointercancel", finishDrag);
  canvas.addEventListener("pointerleave", () => {
    if (draggingNodeId === null) {
      hoveredEdgeId = null;
      canvas.classList.remove("is-switch-hover");
    }
  });
  canvas.addEventListener("keydown", (event) => {
    if (event.key === " ") {
      launchManualPulse().catch(showError);
      event.preventDefault();
      return;
    }
    if (!["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Enter"].includes(event.key)) return;
    if (event.key === "Enter") {
      const edge = model.edges.find((candidate) => candidate.from === selectedNodeId);
      if (edge) {
        edgeSwitchStates.set(edgeKey(edge), !edgeEnabled(edge));
        invalidatePulseTemplate({ clearRuns: false, silence: false });
        refreshActiveRunGeometry(displayModel, { retime: true });
        updateUi();
      }
    } else {
      const node = model.nodes[selectedNodeId];
      if (event.key === "ArrowLeft") node.x = clamp(node.x - 0.01, 0.02, 0.98);
      if (event.key === "ArrowRight") node.x = clamp(node.x + 0.01, 0.02, 0.98);
      if (event.key === "ArrowUp") node.y = clamp(node.y - 0.01, 0.02, 0.98);
      if (event.key === "ArrowDown") node.y = clamp(node.y + 0.01, 0.02, 0.98);
      displayModel = model;
      markCustom();
      invalidatePulseTemplate({ clearRuns: false, silence: false });
      refreshActiveRunGeometry(model, { retime: true });
      updateUi();
    }
    event.preventDefault();
  });

  $("resetAll").addEventListener("click", async () => {
    const wasAudioOn = state.audio;
    if (wasAudioOn) await stopAudio();
    Object.assign(state, initialState);
    state.playing = false;
    state.audio = false;
    latestEvent = null;
    soundedEventCount = 0;
    syncControls();
    if (instrumentMode === "drums") renderDrumMap();
    rebuildModel({ silence: false });
    $("mappingReadout").textContent = instrumentMode === "drums"
      ? "NODE 1 · PASS 0 → CIRCUIT SUB KICK · 100%"
      : "NODE 1 · PASS 0 → A3 · 100%";
    $("liveStatus").textContent = `${instrumentMode === "drums" ? "Graph Drum Machine" : "Graph Synth"} reset.`;
  });

  const handleMidi = (event) => {
    const message = event?.detail?.message;
    if (!message) return;
    if (disposed || documentObject.hidden) {
      event.preventDefault();
      return;
    }
    if (message.type === "noteOn") {
      event.preventDefault();
      const velocity = clamp((message.velocity ?? message.value ?? 100) / 127, 0.05, 1, 0.8);
      launchSeedMidi(message.note, velocity).catch(showError);
    } else if (message.type === "controlChange" && [120, 123].includes(message.controller)) {
      event.preventDefault();
      activeRuns = [];
      audio.silence?.();
      scheduleFrame();
    }
  };
  runtime.addEventListener?.("morphazoid:midi-input", handleMidi);

  const handleReducedMotionChange = (event) => {
    if (!(event?.matches ?? reducedMotionQuery?.matches) || !state.nodeMoving) return;
    state.nodeMoving = false;
    state.nodeMotionPhase = 0;
    displayModel = model;
    resetNodeWalkState();
    invalidatePulseTemplate({ clearRuns: false });
    refreshActiveRunGeometry(model, { retime: true });
    $("liveStatus").textContent = "Node motion paused because reduced motion was enabled.";
    updateUi();
  };
  if (typeof reducedMotionQuery?.addEventListener === "function") {
    reducedMotionQuery.addEventListener("change", handleReducedMotionChange);
  } else {
    reducedMotionQuery?.addListener?.(handleReducedMotionChange);
  }

  function stopBackgroundPlayback(status = "") {
    state.playing = false;
    state.audio = false;
    activeRuns = [];
    nextPulseTime = null;
    audioClockContext = null;
    resetAudioProtection();
    inFlightAudioTriggers.clear();
    setPressed($("playButton"), false);
    setPressed($("audioButton"), false);
    $("audioState").textContent = "off";
    if (status) $("liveStatus").textContent = status;
    audio.close().catch?.(() => {});
    updateUi();
  }

  const handleVisibilityChange = () => {
    if (!documentObject.hidden) return;
    stopBackgroundPlayback("Graph playback stopped because the page moved to the background.");
  };
  documentObject.addEventListener?.("visibilitychange", handleVisibilityChange);

  const handlePageHide = (event) => {
    disposed = !event?.persisted;
    stopBackgroundPlayback();
    if (disposed) {
      runtime.removeEventListener?.("morphazoid:midi-input", handleMidi);
      documentObject.removeEventListener?.("visibilitychange", handleVisibilityChange);
      if (typeof reducedMotionQuery?.removeEventListener === "function") {
        reducedMotionQuery.removeEventListener("change", handleReducedMotionChange);
      } else {
        reducedMotionQuery?.removeListener?.(handleReducedMotionChange);
      }
    }
  };
  runtime.addEventListener?.("pagehide", handlePageHide);
  runtime.addEventListener?.("pageshow", (event) => {
    if (!event.persisted) return;
    disposed = false;
    state.playing = false;
    state.audio = false;
    audioClockContext = null;
    activeRuns = [];
    nextPulseTime = null;
    resetAudioProtection();
    inFlightAudioTriggers.clear();
    setPressed($("audioButton"), false);
    $("audioState").textContent = "off";
    scheduleFrame();
  });

  const ResizeObserverConstructor = runtime.ResizeObserver ?? globalThis.ResizeObserver;
  if (ResizeObserverConstructor) new ResizeObserverConstructor(resizeCanvas).observe(stageWrap);
  else resizeCanvas();
  syncControls();
  if (instrumentMode === "drums") renderDrumMap();
  updateUi();
  resizeCanvas();

  return Object.freeze({
    get mode() { return instrumentMode; },
    get state() { return { ...state }; },
    get model() { return model; },
    get pulseTemplate() { return buildPulseTemplate(); },
    get pulseCount() { return pulseSerial; },
    get activeRunCount() { return activeRuns.length; },
    get soundedEventCount() { return soundedEventCount; },
    get shedAudioEventCount() { return shedAudioEventCount; },
    get inFlightAudioTriggerCount() { return inFlightAudioTriggers.size; },
    get audioProtected() { return audioProtectionActive(); },
    get audioProtectionLevel() { return audioProtectionLevel; },
    get lastAdmittedRunId() { return lastAdmittedRunId; },
    get motionTemplateBuildCount() { return motionTemplateBuildCount; },
    get motionTemplateIntervalMs() { return motionTemplateIntervalMs; },
    get scheduledPulseTime() { return nextPulseTime; },
    launchPulse: launchManualPulse,
    rebuild: rebuildModel,
    dispose: handlePageHide,
  });
}

import {
  BLOWHOLE_CALLS,
  BLOWHOLE_DEFAULTS,
  BLOWHOLE_LIMITS,
  blowholeCallAudibleShift,
  blowholeCall,
  createBlowholeState,
  deriveBlowholeGeometry,
  deriveBlowholeReadout,
  evaluateBlowholeGesture,
  sanitizeBlowholeState,
} from "./src/blowhole.js";
import { connectAudioOutput } from "./src/audio-output-manager.js";
import { unlockAudioContext } from "./src/audio.js";

const $ = (id) => document.getElementById(id);
const clamp = (value, minimum = 0, maximum = 1) => (
  Math.min(maximum, Math.max(minimum, Number.isFinite(Number(value)) ? Number(value) : minimum))
);
const prefersReducedMotion = globalThis.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches ?? false;

const stage = $("stage");
const stageWrap = $("stageWrap");
const stageDrawing = stage.getContext("2d", { alpha: false, desynchronized: true });
const timeline = $("timeline");
const timelineDrawing = timeline.getContext("2d", { alpha: false, desynchronized: true });
const DESIGN_WIDTH = 1_000;
const DESIGN_HEIGHT = 650;

const CONTROL_SPECS = Object.freeze([
  { key: "pressure", format: formatPercent },
  { key: "tension", format: formatPercent },
  { key: "closure", format: formatPercent },
  { key: "asymmetry", format: formatAsymmetry },
  { key: "recycle", format: formatPercent },
  { key: "focus", format: formatPercent },
  { key: "scale", format: formatPercent },
  { key: "roughness", format: formatPercent },
  {
    key: "pulseRateHz",
    format: (value) => `${Number.isInteger(value) ? value : Number(value).toFixed(1)} Hz`,
  },
  { key: "depthM", format: formatDepth },
  { key: "level", format: formatPercent },
]);

const FAMILY_COPY = Object.freeze({
  odontocete: Object.freeze({
    code: "ODONTOCETE",
    anatomyTitle: "Paired nasal source",
    sourceTitle: "Phonic lip pair",
    radiatorTitle: "Sacs and melon",
    pressureLabel: "Nasal pressure",
    pressureHelp: "Air stored in muscular nasal sacs crosses the self-oscillation threshold.",
    tensionLabel: "Phonic lip tension",
    tensionHelp: "Changes vibrating mass, register, and physical center frequency.",
    closureLabel: "Lip closure",
    closureHelp: "Brief, closure-heavy motion produces air-efficient pulses and clicks.",
    asymmetryLabel: "Source laterality",
    asymmetryHelp: "Biases the paired anatomy; authored bottlenose whistles and clicks select the observed left or right side, while other calls may combine sources.",
    recycleLabel: "Nasal air recycling",
    recycleHelp: "Retains pneumatic drive in the closed nasal circuit, extending sustain and stabilizing tissue motion.",
    focusLabel: "Melon focus",
    focusHelp: "Shapes the head filter and forward beam; the melon is not the source.",
    scaleLabel: "Head scale",
    scaleHelp: "Changes cranial cavity and tissue scale while the authored call contour remains intact.",
    source: "paired phonic lips",
    basis: "direct + anatomical",
    evidence: "Phonic-lip tissue vibration, nasal pressure, lateralized sources, air-sac reflection, and melon focusing are evidence-based. Exact live-animal head filtering is reduced to stable browser modes.",
  }),
  sperm: Object.freeze({
    code: "PHYSETER",
    anatomyTitle: "Right nasal click organ",
    sourceTitle: "Single right phonic lips",
    radiatorTitle: "Spermaceti case and junk",
    pressureLabel: "Right nasal pressure",
    pressureHelp: "A muscular right nasal passage pressurizes the single sound-generation complex.",
    tensionLabel: "Phonic lip tension",
    tensionHelp: "Changes the initial click spectrum before reflections traverse the forehead.",
    closureLabel: "Lip collision",
    closureHelp: "A brief, closure-heavy event launches each click into the spermaceti case.",
    asymmetryLabel: "Right source / fixed",
    asymmetryHelp: "Great sperm whales have one functional sound generator on the right; the left passage primarily serves breathing.",
    recycleLabel: "Right nasal air return",
    recycleHelp: "Retains pressure in the isolated right sound passage; spermaceti reflections remain a separate acoustic stage.",
    focusLabel: "Junk acoustic window",
    focusHelp: "Shapes the reflected click leaving the front of the junk; this is not a dolphin melon.",
    scaleLabel: "Head / organ scale",
    scaleHelp: "Changes spermaceti-case delay and head-mode spacing without changing coda rhythm.",
    source: "single right phonic lips",
    basis: "anatomical + tagged acoustics",
    evidence: "The single right phonic-lip source, distal/frontal air sacs, spermaceti reflection path, and terminal junk window are evidence-based. This bent-horn renderer remains a compact browser reduction.",
  }),
  mysticete: Object.freeze({
    code: "MYSTICETE",
    anatomyTitle: "Laryngeal U-fold source",
    sourceTitle: "Coupled fold / cushion",
    radiatorTitle: "Laryngeal sac and body",
    pressureLabel: "Lung pressure",
    pressureHelp: "Air leaving the lungs drives the coupled U-fold and cricoid-cushion mucosa across a narrow gap.",
    tensionLabel: "U-fold tension",
    tensionHelp: "Changes the effective vibrating mass and low fundamental frequency.",
    closureLabel: "Fold / cushion gap",
    closureHelp: "Changes onset threshold, coupled-surface vibration, harmonic richness, and collision strength.",
    asymmetryLabel: "Mode balance / offset",
    asymmetryHelp: "Balances the coupled source; the two-voice humpback phrase detunes fold-to-fat and fold-to-fold reductions.",
    recycleLabel: "Laryngeal sac coupling",
    recycleHelp: "Changes compliant sac memory and resonance; the model does not simulate air transport back to the lungs.",
    focusLabel: "Throat / body radiation",
    focusHelp: "Changes passive tissue-coupled modes without pretending the blowholes radiate the song.",
    scaleLabel: "Larynx scale",
    scaleHelp: "Changes fold mass, air-sac size, and body-mode spacing as one morphology control.",
    source: "coupled U-fold + cushion",
    basis: "direct excised-larynx evidence",
    evidence: "Fold-to-fat vibration is supported by direct excised-larynx experiments in sei, minke, and humpback whales. Exact filtering and radiation in a living, diving whale remain a playable reduction.",
  }),
});

let state = createBlowholeState(BLOWHOLE_DEFAULTS.callId);
let audioContext = null;
let graph = null;
let audioStartupPromise = null;
let pageIsActive = true;
let pageLifecycleGeneration = 0;
let playing = false;
let looping = false;
let manualHeld = false;
let pointerManualHeld = false;
let keyboardManualHeld = false;
let venting = false;
let localPlayStart = 0;
let localPhase = 0;
let stageMetrics = { cssWidth: 1, cssHeight: 1, pixelRatio: 1, scale: 1, offsetX: 0, offsetY: 0 };
let timelineMetrics = { cssWidth: 1, cssHeight: 1, pixelRatio: 1 };
let stageHandles = [];
let pointerDrag = null;
let animationFrame = 0;
let playIntent = 0;
let telemetry = {
  active: false,
  playing: false,
  manual: false,
  phase: 0,
  pressure: 0,
  physicalFrequencyHz: 0,
  monitorFrequencyHz: 0,
  pulseRateHz: 0,
  peak: 0,
  rms: 0,
  valveOpen: false,
};

function currentCall() {
  return blowholeCall(state.callId);
}

function familyCopy() {
  if (currentCall().id === "sperm-whale-coda") return FAMILY_COPY.sperm;
  return FAMILY_COPY[currentCall().family] ?? FAMILY_COPY.odontocete;
}

function formatPercent(value) {
  return `${Math.round(clamp(value) * 100)}%`;
}

function formatAsymmetry(value) {
  const amount = clamp(value, -1, 1);
  if (Math.abs(amount) < 0.025) return "center";
  return `${amount < 0 ? "L" : "R"} ${Math.round(Math.abs(amount) * 100)}%`;
}

function formatDepth(value) {
  const meters = clamp(value, 0, BLOWHOLE_LIMITS.depthM[1]);
  return meters >= 1_000 ? `${(meters / 1_000).toFixed(meters >= 2_000 ? 1 : 2)} km` : `${Math.round(meters)} m`;
}

function formatFrequency(value) {
  const frequency = Math.max(0, Number(value) || 0);
  if (frequency >= 100_000) return `${Math.round(frequency / 1_000)} kHz`;
  if (frequency >= 10_000) return `${(frequency / 1_000).toFixed(1)} kHz`;
  if (frequency >= 1_000) return `${(frequency / 1_000).toFixed(2)} kHz`;
  return `${frequency < 100 ? frequency.toFixed(1) : Math.round(frequency)} Hz`;
}

function formatFrequencyRange(range) {
  return `${formatFrequency(range[0])}–${formatFrequency(range[1])}`;
}

function registerLabel(call) {
  if (call.family === "mysticete") {
    return call.id.includes("two-voice") ? "U-fold / bilateral" : "U-fold / fold-to-fat";
  }
  if (/click|buzz|coda/.test(call.register)) return "M0 / pulse";
  if (/pulsed/.test(call.register)) return "M1 / pulsed";
  return "M2 / tonal";
}

function announce(message) {
  const live = $("liveStatus");
  live.textContent = "";
  requestAnimationFrame(() => { live.textContent = message; });
}

function setAudioPresentation(status = "off", message = "") {
  const on = status === "on";
  $("audioButton").setAttribute("aria-pressed", String(on));
  $("audioButton").dataset.audioState = status;
  $("audioButton").disabled = status === "starting";
  $("audioState").textContent = status === "starting" ? "starting" : on ? "on" : "off";
  $("audioError").hidden = !message;
  $("audioError").textContent = message;
}

function audioConfiguration() {
  return { ...state };
}

function postConfiguration() {
  graph?.sourceNode?.port.postMessage({ type: "configure", configuration: audioConfiguration() });
}

async function createAudioGraph() {
  const Context = globalThis.AudioContext ?? globalThis.webkitAudioContext;
  if (!Context) throw new Error("This browser does not provide Web Audio.");
  const context = new Context({ latencyHint: "interactive", sampleRate: 48_000 });
  let releaseOutput = null;
  unlockAudioContext(context);
  try {
    await context.audioWorklet.addModule(new URL("./src/blowhole-processor.js", import.meta.url));
    const sourceNode = new AudioWorkletNode(context, "blowhole-physical-model", {
      numberOfInputs: 0,
      numberOfOutputs: 1,
      outputChannelCount: [2],
      channelCount: 2,
      channelCountMode: "explicit",
      processorOptions: { configuration: audioConfiguration() },
    });
    const masterGain = context.createGain();
    const compressor = context.createDynamicsCompressor();
    const analyser = context.createAnalyser();
    masterGain.gain.value = state.level;
    compressor.threshold.value = -14;
    compressor.knee.value = 18;
    compressor.ratio.value = 5;
    compressor.attack.value = 0.002;
    compressor.release.value = 0.18;
    analyser.fftSize = 2_048;
    analyser.smoothingTimeConstant = 0.52;
    sourceNode.connect(masterGain);
    masterGain.connect(compressor);
    compressor.connect(analyser);
    releaseOutput = connectAudioOutput(context, analyser, { runtime: globalThis });
    sourceNode.port.onmessage = (event) => {
      if (event.data?.type !== "telemetry") return;
      telemetry = { ...telemetry, ...event.data };
      if (playing && !looping && !telemetry.playing && telemetry.phase >= 0.99) {
        playing = false;
        updateTransportPresentation();
      }
    };
    sourceNode.onprocessorerror = () => setAudioPresentation(
      "error",
      "The cetacean physical model stopped unexpectedly. Reload the page to reset it.",
    );
    return { context, sourceNode, masterGain, compressor, analyser, releaseOutput };
  } catch (error) {
    releaseOutput?.();
    try { await context.close?.(); } catch { /* Preserve the original startup error. */ }
    throw error;
  }
}

async function ensureAudio() {
  if (!graph) {
    if (!audioStartupPromise) {
      setAudioPresentation("starting");
      const startupLifecycleGeneration = pageLifecycleGeneration;
      const startup = createAudioGraph()
        .then((createdGraph) => {
          if (!pageIsActive || startupLifecycleGeneration !== pageLifecycleGeneration) {
            createdGraph.releaseOutput?.();
            void createdGraph.context.close?.();
            return false;
          }
          graph = createdGraph;
          audioContext = graph.context;
          return true;
        })
        .catch((error) => {
          console.error(error);
          if (pageIsActive && startupLifecycleGeneration === pageLifecycleGeneration) {
            setAudioPresentation("error", error?.message || "Unable to start Blowhole audio.");
          }
          return false;
        })
        .finally(() => {
          if (audioStartupPromise === startup) audioStartupPromise = null;
        });
      audioStartupPromise = startup;
    }
    if (!(await audioStartupPromise) || !graph) return false;
  }
  const activeGraph = graph;
  const activeContext = audioContext;
  try {
    unlockAudioContext(activeContext);
    await activeContext.resume();
    if (
      !pageIsActive
      || activeGraph !== graph
      || activeContext !== audioContext
    ) {
      if (activeContext.state === "running") await activeContext.suspend();
      return false;
    }
    postConfiguration();
    setAudioPresentation("on");
    return true;
  } catch (error) {
    console.error(error);
    setAudioPresentation("error", error?.message || "The browser blocked audio startup.");
    return false;
  }
}

async function toggleAudio() {
  if (audioContext?.state === "running") {
    stopPerformance({ announceState: false });
    graph.sourceNode.port.postMessage({ type: "silence" });
    await audioContext.suspend();
    setAudioPresentation("off");
    announce("Blowhole audio off");
    return;
  }
  if (await ensureAudio()) announce("Blowhole audio on");
}

function updateTransportPresentation() {
  $("playButton").setAttribute("aria-pressed", String(playing));
  $("playButton").querySelector("span[aria-hidden]").textContent = playing ? "■" : "▶";
  $("playLabel").textContent = playing ? "Stop call" : "Play call";
  $("playState").textContent = playing
    ? looping ? "looping gesture" : "gesture sounding"
    : "space · one gesture";
  $("loopButton").setAttribute("aria-pressed", String(looping));
  $("loopState").textContent = looping ? "on" : "off";
}

async function startCall() {
  const intent = ++playIntent;
  if (!(await ensureAudio()) || intent !== playIntent) return false;
  if (currentCall().id !== "sperm-whale-coda") closeSurfaceBreath();
  stopManual();
  playing = true;
  localPlayStart = performance.now();
  localPhase = 0;
  graph.sourceNode.port.postMessage({
    type: "play",
    callId: state.callId,
    loop: looping,
  });
  updateTransportPresentation();
  const call = currentCall();
  announce(`${call.species}: ${call.label} playing`);
  return true;
}

function stopCall({ announceState = true } = {}) {
  playIntent += 1;
  if (!playing) return;
  playing = false;
  graph?.sourceNode?.port.postMessage({ type: "stop" });
  updateTransportPresentation();
  if (announceState) announce("Call stopped");
}

function toggleCall() {
  if (playing) stopCall();
  else startCall();
}

function setLoop(active) {
  looping = Boolean(active);
  graph?.sourceNode?.port.postMessage({ type: "loop", active: looping });
  updateTransportPresentation();
  announce(looping ? "Call loop on" : "Call loop off");
}

function updateManualState() {
  const next = pointerManualHeld || keyboardManualHeld;
  if (next === manualHeld) return;
  manualHeld = next;
  $("holdPad").setAttribute("aria-pressed", String(manualHeld));
  graph?.sourceNode?.port.postMessage({ type: "manual", active: manualHeld });
  if (manualHeld) {
    playing = false;
    updateTransportPresentation();
    announce(`${familyCopy().source}: manual pressure on`);
  } else {
    announce("Manual pressure released");
  }
}

async function startManual(source = "pointer") {
  if (source === "keyboard") keyboardManualHeld = true;
  else pointerManualHeld = true;
  if (!(await ensureAudio())) {
    stopManual(source);
    return;
  }
  if (currentCall().id !== "sperm-whale-coda") closeSurfaceBreath();
  updateManualState();
}

function stopManual(source = null) {
  if (!source || source === "pointer") pointerManualHeld = false;
  if (!source || source === "keyboard") keyboardManualHeld = false;
  updateManualState();
}

function stopPerformance({ announceState = true } = {}) {
  stopCall({ announceState: false });
  stopManual();
  graph?.sourceNode?.port.postMessage({ type: "stop" });
  if (announceState) announce("Cetacean sound stopped");
}

function closeSurfaceBreath() {
  clearTimeout(ventSurfaceBreath.timer);
  venting = false;
  $("ventButton").classList.remove("is-venting");
  graph?.sourceNode?.port.postMessage({ type: "stopVent" });
  updateValvePresentation();
}

async function ventSurfaceBreath() {
  if (!(await ensureAudio())) return;
  const surfaceClickException = currentCall().id === "sperm-whale-coda";
  if (!surfaceClickException && (playing || manualHeld)) {
    stopPerformance({ announceState: false });
  }
  venting = true;
  $("ventButton").classList.add("is-venting");
  updateValvePresentation();
  graph.sourceNode.port.postMessage({ type: "vent", strength: 0.92 });
  announce(surfaceClickException
    ? "Surface breath opens the left airway; the sperm whale's right sound passage can remain isolated and click"
    : "Surface breath opens the external valve; underwater calls use the hidden internal source");
  clearTimeout(ventSurfaceBreath.timer);
  ventSurfaceBreath.timer = setTimeout(() => {
    closeSurfaceBreath();
  }, 620);
}

function updateValvePresentation() {
  const open = venting || telemetry.valveOpen;
  const valve = $("valveState");
  valve.dataset.state = open ? "open" : "sealed";
  valve.querySelector("b").textContent = open ? "open to breathe" : "sealed underwater";
}

function updateRangeFill(input) {
  if (!input) return;
  const minimum = Number(input.min) || 0;
  const maximum = Number(input.max) || 1;
  const progress = clamp((Number(input.value) - minimum) / Math.max(1e-9, maximum - minimum));
  input.style.setProperty("--range-progress", `${(progress * 100).toFixed(2)}%`);
}

function setStateValue(key, value, { announceState = false } = {}) {
  state = sanitizeBlowholeState({ ...state, [key]: value }, state);
  if (key === "level") {
    graph?.masterGain?.gain.setTargetAtTime(state.level, audioContext.currentTime, 0.012);
  } else {
    postConfiguration();
  }
  syncControl(key);
  updateReadouts();
  if (announceState) {
    const spec = CONTROL_SPECS.find((candidate) => candidate.key === key);
    const label = $(`${key}Label`)?.textContent ?? $(key)?.previousElementSibling?.querySelector("b")?.textContent ?? key;
    announce(`${label}: ${spec?.format(state[key]) ?? state[key]}`);
  }
}

function syncControl(key) {
  const spec = CONTROL_SPECS.find((candidate) => candidate.key === key);
  if (!spec) return;
  const input = $(key);
  const output = $(`${key}Out`);
  if (input) {
    input.value = String(state[key]);
    updateRangeFill(input);
  }
  if (output) {
    const value = spec.format(state[key]);
    output.value = value;
    output.textContent = value;
  }
}

function syncLimits() {
  for (const spec of CONTROL_SPECS) {
    const input = $(spec.key);
    const limits = BLOWHOLE_LIMITS[spec.key];
    if (!input || !limits) continue;
    input.min = String(limits[0]);
    input.max = String(limits[1]);
  }
}

function syncControls() {
  for (const spec of CONTROL_SPECS) syncControl(spec.key);
  $("monitorMode").value = state.monitorMode;
  $("monitorModeOut").value = state.monitorMode === "audible" ? "audible proxy" : "physical band";
  $("monitorModeOut").textContent = $("monitorModeOut").value;
  graph?.masterGain?.gain.setTargetAtTime(state.level, audioContext.currentTime, 0.012);
  updateReadouts();
}

function updateFamilyCopy() {
  const call = currentCall();
  const copy = familyCopy();
  $("familyCode").textContent = copy.code;
  $("anatomyTitle").textContent = copy.anatomyTitle;
  $("sourceControlTitle").textContent = copy.sourceTitle;
  $("radiatorControlTitle").textContent = copy.radiatorTitle;
  for (const key of ["pressure", "tension", "closure", "asymmetry", "recycle", "focus", "scale"]) {
    const label = $(`${key}Label`);
    const help = $(`${key}Help`);
    if (label) label.textContent = copy[`${key}Label`];
    if (help) help.textContent = copy[`${key}Help`];
  }
  $("sourceReadout").textContent = call.id === "bottlenose-signature-whistle"
    ? "left phonic lips"
    : ["dolphin-search-clicks", "dolphin-terminal-buzz"].includes(call.id)
      ? "right phonic lips"
      : call.id === "orca-pulsed-call"
        ? "M1 phonic-lip source · side unassigned"
      : copy.source;
  const blueComparative = call.id === "blue-whale-b-call";
  $("evidenceText").textContent = blueComparative
    ? "The baleen-whale U-fold family mechanism is supported by sei, minke, and humpback larynges. Applying that mechanism to this Northeast Pacific blue-whale call is comparative anatomical inference, not direct blue-whale phonation data."
    : copy.evidence;
  $("basisReadout").textContent = blueComparative
    ? "comparative anatomical inference"
    : copy.basis;
  $("blowholeFact").textContent = call.family === "mysticete"
    ? "paired nares · sealed underwater"
    : call.id === "sperm-whale-coda"
      ? "left external naris · sealed underwater"
      : "one external naris · sealed underwater";
  $("asymmetry").disabled = [
    "bottlenose-signature-whistle",
    "dolphin-search-clicks",
    "dolphin-terminal-buzz",
    "orca-pulsed-call",
    "sperm-whale-coda",
  ].includes(call.id);
  if (call.family === "mysticete" && call.id !== "humpback-two-voice-phrase") {
    $("asymmetryLabel").textContent = "Radiation bias";
    $("asymmetryHelp").textContent = "Moves the reduced throat/body radiation field in stereo; mode detuning is available in the two-voice humpback phrase.";
  }
  $("depthHelp").textContent = call.family === "mysticete"
    ? "The demonstrated baleen source needs lung air and is strongly depth-limited in this model."
    : "Compact nasal air spaces and internal recycling support odontocete clicks during deep dives.";
  const pulseInput = $("pulseRateHz");
  const pulseRange = call.physicalRange.pulseRateHz;
  const pulseAvailable = pulseRange[1] > 0;
  pulseInput.disabled = !pulseAvailable;
  pulseInput.min = String(pulseAvailable ? pulseRange[0] : 0);
  pulseInput.max = String(pulseAvailable ? pulseRange[1] : 0);
  pulseInput.step = call.pulseLockedToFundamental ? "1" : "0.5";
  $("pulseRateHzLabel").textContent = call.pulseLockedToFundamental
    ? "Manual M1 base f0 / pulse rate"
    : pulseAvailable ? "Manual click rate" : "Manual pulse rate · inactive";
  $("pulseRateHzHelp").textContent = call.pulseLockedToFundamental
    ? "For M1, HOLD drives one tissue-pulse fundamental; tension bends this base rate and nonlinear motion supplies harmonics."
    : pulseAvailable
      ? "Sets M0 click repetition while HOLD TO SOUND is pressed; authored calls keep their own contour."
      : "This tonal laryngeal or M2 source has no independent pulse-rate control.";
  for (const button of document.querySelectorAll(".blowhole-family-tabs [data-family]")) {
    button.setAttribute("aria-pressed", String(button.dataset.family === call.family));
  }
}

function monitorSummary(physicalFrequencyHz) {
  if (state.monitorMode === "physical") {
    return physicalFrequencyHz > 23_500 ? "physical · above Nyquist" : "physical band · 1:1";
  }
  const shiftOctaves = blowholeCallAudibleShift(currentCall());
  if (!shiftOctaves) return "audible · 1:1";
  const direction = shiftOctaves > 0 ? "+" : "";
  return `${direction}${shiftOctaves} oct → ${formatFrequency(physicalFrequencyHz * 2 ** shiftOctaves)}`;
}

function displayPhase() {
  if (manualHeld || telemetry.manual) return 0.45;
  if (telemetry.active && telemetry.callId === state.callId) return clamp(telemetry.phase);
  if (playing) {
    const duration = currentCall().durationMs;
    const raw = (performance.now() - localPlayStart) / Math.max(1, duration);
    localPhase = looping ? raw % 1 : clamp(raw);
    return localPhase;
  }
  return 0;
}

function updateReadouts() {
  const call = currentCall();
  const phase = displayPhase();
  const readout = deriveBlowholeReadout(state, phase);
  const physical = telemetry.active && telemetry.physicalFrequencyHz
    ? telemetry.physicalFrequencyHz
    : readout.physicalFrequencyHz;
  $("physicalReadout").textContent = telemetry.active
    ? `${formatFrequency(physical)} live`
    : formatFrequencyRange(call.frequencyRangeHz);
  $("monitorReadout").textContent = monitorSummary(physical);
  $("airReadout").textContent = call.family === "odontocete"
    ? call.id === "sperm-whale-coda"
      ? `${formatPercent(state.recycle)} right nasal return`
      : `${formatPercent(state.recycle)} nasal return`
    : `${formatPercent(state.recycle)} sac coupling · memory`;
  $("timelineSpecies").textContent = call.species;
  $("timelineCall").textContent = call.label.replace(call.species, "").trim() || call.label;
  $("registerReadout").textContent = registerLabel(call);
  $("durationReadout").textContent = `${(call.durationMs / 1_000).toFixed(call.durationMs >= 10_000 ? 1 : 2)} s`;
  $("phaseReadout").textContent = manualHeld
    ? "manual"
    : playing ? `${Math.round(phase * 100)}%` : "ready";
  $("sourceSummary").textContent = `${formatPercent(state.pressure)} pressure · ${registerLabel(call).split(" /")[0]}`;
  $("radiatorSummary").textContent = call.family === "mysticete"
    ? `${formatPercent(state.recycle)} sac coupling · ${formatPercent(state.focus)} radiation`
    : `${formatPercent(state.recycle)} pneumatic reuse · ${formatPercent(state.focus)} focus`;
  $("environmentSummary").textContent = `${formatDepth(state.depthM)} · ${state.monitorMode === "audible" ? "audible map" : "physical band"}`;
  updateValvePresentation();
}

function buildCallSelect() {
  const select = $("callSelect");
  select.innerHTML = "";
  for (const family of ["odontocete", "mysticete"]) {
    const group = document.createElement("optgroup");
    group.label = family === "odontocete" ? "Toothed whales · nasal" : "Baleen whales · laryngeal";
    for (const call of BLOWHOLE_CALLS.filter((candidate) => candidate.family === family)) {
      const option = document.createElement("option");
      option.value = call.id;
      option.textContent = call.label;
      group.append(option);
    }
    select.append(group);
  }
}

function buildCallButtons() {
  const call = currentCall();
  const container = $("callButtons");
  container.innerHTML = "";
  for (const candidate of BLOWHOLE_CALLS.filter(({ family }) => family === call.family)) {
    const button = document.createElement("button");
    button.type = "button";
    button.dataset.callId = candidate.id;
    button.setAttribute("aria-pressed", String(candidate.id === call.id));
    button.innerHTML = `<b>${candidate.label}</b><small>${registerLabel(candidate)}</small>`;
    button.addEventListener("click", () => setCall(candidate.id));
    container.append(button);
  }
}

function setCall(callId, { announceState = true } = {}) {
  const call = blowholeCall(callId);
  const preserved = {
    level: state.level,
    depthM: state.depthM,
    monitorMode: state.monitorMode,
  };
  stopPerformance({ announceState: false });
  state = createBlowholeState(call.id, preserved);
  $("callSelect").value = call.id;
  $("callDescription").textContent = call.description;
  updateFamilyCopy();
  buildCallButtons();
  syncControls();
  postConfiguration();
  localPhase = 0;
  if (announceState) announce(`${call.species}: ${call.label} loaded`);
}

function setFamily(family) {
  const match = BLOWHOLE_CALLS.find((call) => call.family === family);
  if (match) setCall(match.id);
}

function resetAll() {
  stopPerformance({ announceState: false });
  looping = false;
  state = createBlowholeState(BLOWHOLE_DEFAULTS.callId);
  $("callSelect").value = state.callId;
  $("callDescription").textContent = currentCall().description;
  updateFamilyCopy();
  buildCallButtons();
  syncControls();
  postConfiguration();
  updateTransportPresentation();
  announce("Blowhole anatomy and call reset");
}

function fitCanvas(canvas, context, metrics, designWidth = null, designHeight = null) {
  const rectangle = canvas.getBoundingClientRect();
  const pixelRatio = Math.min(2, globalThis.devicePixelRatio || 1);
  const cssWidth = Math.max(1, rectangle.width);
  const cssHeight = Math.max(1, rectangle.height);
  const width = Math.max(1, Math.round(cssWidth * pixelRatio));
  const height = Math.max(1, Math.round(cssHeight * pixelRatio));
  if (canvas.width !== width || canvas.height !== height) {
    canvas.width = width;
    canvas.height = height;
  }
  metrics.cssWidth = cssWidth;
  metrics.cssHeight = cssHeight;
  metrics.pixelRatio = pixelRatio;
  if (designWidth && designHeight) {
    metrics.scale = Math.min(cssWidth / designWidth, cssHeight / designHeight);
    metrics.offsetX = (cssWidth - designWidth * metrics.scale) * 0.5;
    metrics.offsetY = (cssHeight - designHeight * metrics.scale) * 0.5;
  }
  context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
  return metrics;
}

function stagePoint(event) {
  const rectangle = stage.getBoundingClientRect();
  return {
    x: (event.clientX - rectangle.left - stageMetrics.offsetX) / stageMetrics.scale,
    y: (event.clientY - rectangle.top - stageMetrics.offsetY) / stageMetrics.scale,
  };
}

function drawRoundedRect(context, x, y, width, height, radius) {
  const r = Math.min(radius, width * 0.5, height * 0.5);
  context.beginPath();
  context.moveTo(x + r, y);
  context.arcTo(x + width, y, x + width, y + height, r);
  context.arcTo(x + width, y + height, x, y + height, r);
  context.arcTo(x, y + height, x, y, r);
  context.arcTo(x, y, x + width, y, r);
  context.closePath();
}

function drawLabel(context, text, x, y, targetX, targetY, color = "rgba(184,218,216,.72)", align = "left") {
  context.save();
  const annotationScale = Math.max(0.05, stageMetrics.scale);
  context.strokeStyle = color;
  context.fillStyle = color;
  context.lineWidth = Math.max(1, 1 / annotationScale);
  context.setLineDash([3 / annotationScale, 5 / annotationScale]);
  context.beginPath();
  context.moveTo(targetX, targetY);
  context.lineTo(x + (align === "right" ? -6 : 6), y - 4);
  context.stroke();
  context.setLineDash([]);
  context.font = `700 ${Math.max(11, 9 / annotationScale)}px ui-monospace, SFMono-Regular, Menlo, monospace`;
  context.textAlign = align;
  context.fillText(text.toUpperCase(), x, y);
  context.restore();
}

function drawHandle(context, key, x, y, color, axis = "x") {
  const active = pointerDrag?.key === key;
  const scale = Math.max(0.05, stageMetrics.scale);
  const hitRadius = Math.max(18, 24 / scale);
  const halfSize = clamp(9 / scale, 7, 20);
  stageHandles.push({ key, x, y, radius: hitRadius, axis, color });
  context.save();
  context.translate(x, y);
  context.rotate(Math.PI * 0.25);
  context.fillStyle = active ? "#f6fff8" : color;
  context.strokeStyle = "rgba(3,16,21,.92)";
  context.lineWidth = 4;
  context.shadowColor = color;
  context.shadowBlur = active ? 22 : 12;
  context.fillRect(-halfSize, -halfSize, halfSize * 2, halfSize * 2);
  context.strokeRect(-halfSize, -halfSize, halfSize * 2, halfSize * 2);
  context.restore();
}

function polylinePoint(points, phase) {
  const amount = ((phase % 1) + 1) % 1;
  const lengths = [];
  let total = 0;
  for (let index = 1; index < points.length; index += 1) {
    const dx = points[index][0] - points[index - 1][0];
    const dy = points[index][1] - points[index - 1][1];
    total += Math.hypot(dx, dy);
    lengths.push(total);
  }
  const target = amount * total;
  let previousLength = 0;
  for (let index = 1; index < points.length; index += 1) {
    if (target <= lengths[index - 1]) {
      const span = Math.max(1e-9, lengths[index - 1] - previousLength);
      const local = (target - previousLength) / span;
      return [
        points[index - 1][0] + (points[index][0] - points[index - 1][0]) * local,
        points[index - 1][1] + (points[index][1] - points[index - 1][1]) * local,
      ];
    }
    previousLength = lengths[index - 1];
  }
  return points.at(-1);
}

function drawFlow(context, points, color, time, amount = 1, reverse = false) {
  context.save();
  context.strokeStyle = color;
  context.globalAlpha = 0.25 + amount * 0.35;
  context.lineWidth = 2;
  context.setLineDash([5, 9]);
  context.beginPath();
  points.forEach(([x, y], index) => index ? context.lineTo(x, y) : context.moveTo(x, y));
  context.stroke();
  context.setLineDash([]);
  const speed = prefersReducedMotion ? 0 : time * 0.00012;
  for (let index = 0; index < 7; index += 1) {
    const phase = reverse ? -(speed + index / 7) : speed + index / 7;
    const [x, y] = polylinePoint(points, phase);
    context.globalAlpha = 0.22 + amount * 0.66;
    context.fillStyle = color;
    context.shadowColor = color;
    context.shadowBlur = 9;
    context.beginPath();
    context.arc(x, y, 2.2 + amount * 1.1, 0, TAU);
    context.fill();
  }
  context.restore();
}

const TAU = Math.PI * 2;

function drawSoundBeam(context, originX, originY, time, amount, focus, family) {
  const intensity = clamp(amount * 7 + (playing || manualHeld ? 0.3 : 0));
  if (intensity <= 0.01) return;
  context.save();
  context.translate(originX, originY);
  context.strokeStyle = "#59eed2";
  context.shadowColor = "rgba(89,238,210,.8)";
  context.shadowBlur = 10;
  context.lineWidth = 1.3;
  const spacing = family === "odontocete" ? 50 : 38;
  const waveCount = family === "odontocete" ? 7 : 5;
  const phase = prefersReducedMotion ? 0 : (time * 0.06) % spacing;
  for (let index = 0; index < waveCount; index += 1) {
    const radius = 22 + index * spacing + phase;
    const alpha = intensity * (1 - index / (waveCount + 1)) * 0.42;
    context.globalAlpha = alpha;
    context.beginPath();
    if (family === "odontocete") {
      const spread = 0.42 - focus * 0.22;
      context.arc(0, 0, radius, -spread, spread);
    } else {
      context.arc(0, 0, radius, -1.15, 1.15);
    }
    context.stroke();
  }
  context.restore();
}

function drawDolphin(context, geometry, gesture, time, surfaceValveOpen = false) {
  const active = clamp(telemetry.rms * 12 + gesture.pressure * (playing || manualHeld ? 0.24 : 0));
  const breath = geometry.nasalAirSacInflation;
  const focus = geometry.melonFocus;
  context.save();
  context.lineJoin = "round";
  context.lineCap = "round";

  const bodyGradient = context.createLinearGradient(110, 170, 860, 480);
  bodyGradient.addColorStop(0, "rgba(21,77,83,.34)");
  bodyGradient.addColorStop(0.62, "rgba(35,113,116,.2)");
  bodyGradient.addColorStop(1, "rgba(37,143,139,.09)");
  context.fillStyle = bodyGradient;
  context.strokeStyle = "rgba(100,211,206,.5)";
  context.lineWidth = 2;
  context.beginPath();
  context.moveTo(76, 360);
  context.bezierCurveTo(170, 198, 360, 148, 548, 178);
  context.bezierCurveTo(675, 145, 748, 185, 785, 242);
  context.bezierCurveTo(831, 256, 906, 279, 962, 306);
  context.bezierCurveTo(883, 328, 828, 343, 774, 350);
  context.bezierCurveTo(717, 451, 560, 511, 369, 500);
  context.bezierCurveTo(222, 491, 129, 442, 76, 360);
  context.closePath();
  context.fill();
  context.stroke();

  context.strokeStyle = "rgba(115,198,198,.18)";
  context.lineWidth = 1;
  for (let offset = 0; offset < 5; offset += 1) {
    context.beginPath();
    context.moveTo(145, 330 + offset * 16);
    context.bezierCurveTo(370, 240 + offset * 20, 620, 290 + offset * 10, 826, 316 + offset * 5);
    context.stroke();
  }

  context.fillStyle = "rgba(14,37,44,.88)";
  context.strokeStyle = "rgba(156,222,218,.26)";
  context.lineWidth = 1.5;
  context.beginPath();
  context.ellipse(333, 413, 116, 73, -0.1, 0, TAU);
  context.fill();
  context.stroke();
  context.fillStyle = `rgba(255,113,91,${0.12 + gesture.pressure * 0.32})`;
  context.beginPath();
  context.ellipse(307, 414, 58 + gesture.pressure * 13, 47 + gesture.pressure * 9, -0.15, 0, TAU);
  context.ellipse(365, 406, 51 + gesture.pressure * 11, 42 + gesture.pressure * 8, 0.16, 0, TAU);
  context.fill();
  drawFlow(context, [[334, 382], [374, 330], [425, 285], [500, 274]], "#ff715b", time, gesture.pressure);

  const sacGradient = context.createRadialGradient(438, 248, 10, 438, 248, 85);
  sacGradient.addColorStop(0, `rgba(89,238,210,${0.1 + breath * 0.25})`);
  sacGradient.addColorStop(1, "rgba(18,77,85,.08)");
  context.fillStyle = sacGradient;
  context.strokeStyle = "rgba(89,238,210,.5)";
  context.lineWidth = 1.5;
  context.beginPath();
  context.ellipse(441, 245, 57 + breath * 23, 34 + breath * 14, -0.12, 0, TAU);
  context.fill();
  context.stroke();
  context.beginPath();
  context.ellipse(443, 302, 52 + breath * 20, 29 + breath * 12, 0.1, 0, TAU);
  context.fill();
  context.stroke();

  const lipGlow = 0.22 + (playing || manualHeld ? gesture.closure * 0.58 : 0.12);
  context.shadowColor = "#d893ff";
  context.shadowBlur = 13 * active;
  context.lineWidth = 8;
  context.strokeStyle = `rgba(216,147,255,${geometry.leftPhonicLipActive ? lipGlow : 0.12})`;
  context.beginPath();
  context.moveTo(500, 245 - geometry.leftPhonicLipGap * 8);
  context.quadraticCurveTo(521, 258, 501, 274 + geometry.leftPhonicLipGap * 8);
  context.stroke();
  context.strokeStyle = `rgba(216,147,255,${geometry.rightPhonicLipActive ? lipGlow : 0.12})`;
  context.beginPath();
  context.moveTo(521, 245 - geometry.rightPhonicLipGap * 8);
  context.quadraticCurveTo(542, 258, 522, 275 + geometry.rightPhonicLipGap * 8);
  context.stroke();
  if (geometry.activeNasalSource === "side-unassigned") {
    const gap = geometry.unassignedPhonicLipGap * 8;
    context.strokeStyle = `rgba(216,147,255,${lipGlow})`;
    context.beginPath();
    context.moveTo(510, 245 - gap);
    context.quadraticCurveTo(531, 258, 511, 275 + gap);
    context.stroke();
  }
  context.shadowBlur = 0;

  drawFlow(context, [[519, 276], [491, 302], [449, 307], [421, 286], [463, 262], [505, 257]], "#59eed2", time, state.recycle, true);

  const melonGradient = context.createRadialGradient(682, 251, 15, 700, 270, 145);
  melonGradient.addColorStop(0, `rgba(199,255,67,${0.14 + focus * 0.22})`);
  melonGradient.addColorStop(0.52, `rgba(89,238,210,${0.07 + focus * 0.14})`);
  melonGradient.addColorStop(1, "rgba(18,66,73,.02)");
  context.fillStyle = melonGradient;
  context.strokeStyle = `rgba(199,255,67,${0.24 + focus * 0.36})`;
  context.lineWidth = 1.5;
  context.beginPath();
  context.ellipse(684, 260, 112, 78, -0.12, 0, TAU);
  context.fill();
  context.stroke();
  for (let index = 0; index < 5; index += 1) {
    context.strokeStyle = `rgba(199,255,67,${0.08 + index * 0.025})`;
    context.beginPath();
    context.ellipse(655 + index * 10, 260, 46 + index * 11, 32 + index * 7, -0.12, 0, TAU);
    context.stroke();
  }

  context.strokeStyle = "rgba(231,248,240,.58)";
  context.lineWidth = 3;
  context.beginPath();
  context.moveTo(467, 181);
  context.quadraticCurveTo(483, 171, 500, 181);
  context.stroke();
  if (surfaceValveOpen) {
    context.fillStyle = "rgba(89,238,210,.22)";
    context.strokeStyle = "#59eed2";
    context.lineWidth = 2.5;
    context.beginPath();
    context.ellipse(483, 180, 13, 7, 0, 0, TAU);
    context.fill();
    context.stroke();
  } else {
    context.strokeStyle = "#ff715b";
    context.lineWidth = 2;
    context.beginPath();
    context.moveTo(475, 174);
    context.lineTo(492, 188);
    context.moveTo(491, 174);
    context.lineTo(475, 188);
    context.stroke();
  }

  drawSoundBeam(context, 775, 286, time, active, focus, "odontocete");
  drawLabel(
    context,
    surfaceValveOpen ? "blowhole / open to breathe" : "blowhole / sealed underwater",
    400,
    126,
    482,
    178,
    surfaceValveOpen ? "rgba(89,238,210,.82)" : "rgba(255,113,91,.78)",
    "right",
  );
  drawLabel(context, "vestibular air sacs", 311, 225, 406, 252, "rgba(89,238,210,.7)", "right");
  const activeLipLabel = geometry.activeNasalSource === "side-unassigned"
    ? "one M1 source / side unassigned"
    : geometry.activeNasalSource === "paired"
    ? "paired phonic lips"
    : `${geometry.activeNasalSource} phonic lips / active`;
  drawLabel(context, activeLipLabel, 532, 211, 518, 252, "rgba(216,147,255,.82)");
  drawLabel(context, "melon / acoustic lens", 730, 186, 688, 232, "rgba(199,255,67,.75)");
  drawLabel(context, "forward water beam", 893, 241, 800, 281, "rgba(89,238,210,.72)");
  drawLabel(context, "pressure supply", 188, 514, 306, 430, "rgba(255,113,91,.72)");

  drawHandle(context, "pressure", 270, 450 - state.pressure * 48, "#ff715b", "y");
  drawHandle(context, "recycle", 414 + state.recycle * 48, 304, "#59eed2", "x");
  drawHandle(context, "tension", 495 + state.tension * 47, 260, "#d893ff", "x");
  drawHandle(context, "focus", 640 + state.focus * 86, 303, "#c7ff43", "x");
  context.restore();
}

function drawSpermWhale(context, geometry, gesture, time, surfaceValveOpen = false) {
  const active = clamp(telemetry.rms * 15 + gesture.pressure * (playing || manualHeld ? 0.24 : 0));
  const focus = geometry.spermacetiCaseFocus;
  context.save();
  context.lineJoin = "round";
  context.lineCap = "round";

  const bodyGradient = context.createLinearGradient(68, 170, 930, 480);
  bodyGradient.addColorStop(0, "rgba(14,54,65,.32)");
  bodyGradient.addColorStop(0.66, "rgba(35,101,106,.25)");
  bodyGradient.addColorStop(1, "rgba(29,126,119,.11)");
  context.fillStyle = bodyGradient;
  context.strokeStyle = "rgba(104,206,201,.5)";
  context.lineWidth = 2;
  context.beginPath();
  context.moveTo(66, 380);
  context.bezierCurveTo(120, 238, 240, 185, 362, 180);
  context.lineTo(818, 164);
  context.quadraticCurveTo(911, 171, 938, 247);
  context.lineTo(928, 402);
  context.quadraticCurveTo(771, 428, 606, 466);
  context.bezierCurveTo(387, 517, 163, 489, 66, 380);
  context.closePath();
  context.fill();
  context.stroke();

  context.strokeStyle = "rgba(118,199,198,.13)";
  context.lineWidth = 1;
  for (let offset = 0; offset < 6; offset += 1) {
    context.beginPath();
    context.moveTo(124, 370 + offset * 13);
    context.bezierCurveTo(350, 292 + offset * 17, 663, 335 + offset * 10, 921, 320 + offset * 8);
    context.stroke();
  }

  // Lung pressure and the right nasal passage are kept separate from the
  // large left respiratory passage in this deliberately asymmetric cutaway.
  context.fillStyle = `rgba(255,113,91,${0.1 + gesture.pressure * 0.32})`;
  context.strokeStyle = "rgba(255,113,91,.38)";
  context.lineWidth = 1.5;
  context.beginPath();
  context.ellipse(247, 420, 104 + gesture.pressure * 13, 51 + gesture.pressure * 8, -0.08, 0, TAU);
  context.fill();
  context.stroke();
  drawFlow(context, [[305, 396], [421, 359], [566, 314], [741, 263], [807, 249]], "#ff715b", time, gesture.pressure);

  const caseGradient = context.createLinearGradient(355, 200, 805, 275);
  caseGradient.addColorStop(0, `rgba(89,238,210,${0.06 + focus * 0.09})`);
  caseGradient.addColorStop(0.62, `rgba(199,255,67,${0.08 + focus * 0.18})`);
  caseGradient.addColorStop(1, "rgba(89,238,210,.06)");
  context.fillStyle = caseGradient;
  context.strokeStyle = `rgba(199,255,67,${0.25 + focus * 0.4})`;
  context.lineWidth = 1.6;
  context.beginPath();
  context.ellipse(577, 245, 219, 67, -0.025, 0, TAU);
  context.fill();
  context.stroke();

  // Frontal and distal reflectors bound the long spermaceti case.
  context.fillStyle = "rgba(89,238,210,.15)";
  context.strokeStyle = "rgba(89,238,210,.68)";
  context.lineWidth = 5;
  context.beginPath();
  context.arc(365, 247, 42, -1.1, 1.1);
  context.stroke();
  context.beginPath();
  context.arc(793, 247, 34, 2.05, 4.22);
  context.stroke();

  // One right-sided phonic-lip complex launches the initial pulse rearward.
  const gap = geometry.rightPhonicLipGap * 8;
  context.strokeStyle = `rgba(216,147,255,${0.38 + gesture.closure * 0.55})`;
  context.shadowColor = "#d893ff";
  context.shadowBlur = active * 18;
  context.lineWidth = 10;
  context.beginPath();
  context.moveTo(804, 224 - gap);
  context.quadraticCurveTo(824, 244, 802, 266 + gap);
  context.stroke();
  context.shadowBlur = 0;

  // The reflected pulse bends forward through layered junk tissues.
  for (let index = 0; index < 7; index += 1) {
    const x = 500 + index * 49;
    context.fillStyle = `rgba(199,255,67,${0.045 + index * 0.012})`;
    context.strokeStyle = "rgba(199,255,67,.19)";
    context.beginPath();
    context.ellipse(x, 339 + index * 4, 38, 58 - index * 2.4, -0.16, 0, TAU);
    context.fill();
    context.stroke();
  }
  drawFlow(
    context,
    [[806, 245], [689, 218], [512, 213], [365, 247], [470, 306], [625, 347], [820, 366]],
    "#c7ff43",
    time,
    focus,
  );
  drawFlow(context, [[815, 270], [834, 296], [803, 320], [784, 278]], "#59eed2", time, state.recycle, true);

  // The off-center left blowhole is drawn closed above the generator.
  context.strokeStyle = "rgba(231,248,240,.62)";
  context.lineWidth = 3;
  context.beginPath();
  context.moveTo(798, 173);
  context.quadraticCurveTo(815, 161, 833, 173);
  context.stroke();
  if (surfaceValveOpen) {
    context.fillStyle = "rgba(89,238,210,.22)";
    context.strokeStyle = "#59eed2";
    context.lineWidth = 2.5;
    context.beginPath();
    context.ellipse(816, 172, 14, 7, 0, 0, TAU);
    context.fill();
    context.stroke();
  } else {
    context.strokeStyle = "#ff715b";
    context.lineWidth = 2;
    context.beginPath();
    context.moveTo(806, 165);
    context.lineTo(826, 181);
    context.moveTo(826, 165);
    context.lineTo(806, 181);
    context.stroke();
  }

  drawSoundBeam(context, 828, 367, time, active, focus, "odontocete");
  drawLabel(
    context,
    surfaceValveOpen ? "left airway / open to breathe" : "left blowhole / sealed underwater",
    741,
    116,
    816,
    171,
    surfaceValveOpen ? "rgba(89,238,210,.82)" : "rgba(255,113,91,.78)",
    "right",
  );
  drawLabel(context, "frontal reflector", 294, 207, 367, 246, "rgba(89,238,210,.72)", "right");
  drawLabel(context, "spermaceti case", 574, 150, 580, 202, "rgba(199,255,67,.72)", "right");
  drawLabel(context, "single right phonic lips", 854, 214, 811, 244, "rgba(216,147,255,.82)");
  drawLabel(context, "layered junk / exit window", 706, 465, 736, 362, "rgba(199,255,67,.72)", "right");
  drawLabel(context, "pressure supply", 151, 513, 248, 430, "rgba(255,113,91,.72)", "right");

  drawHandle(context, "pressure", 216, 454 - state.pressure * 45, "#ff715b", "y");
  drawHandle(context, "recycle", 792 + state.recycle * 47, 298, "#59eed2", "x");
  drawHandle(context, "tension", 780 + state.tension * 43, 248, "#d893ff", "x");
  drawHandle(context, "focus", 618 + state.focus * 119, 365, "#c7ff43", "x");
  context.restore();
}

function drawBaleenWhale(context, geometry, gesture, time, surfaceValveOpen = false) {
  const drive = geometry.internalPressure;
  const active = clamp(telemetry.rms * 13 + drive * (playing || manualHeld ? 0.24 : 0));
  const sac = geometry.laryngealSacInflation;
  const focus = geometry.tissueRadiationFocus;
  context.save();
  context.lineJoin = "round";
  context.lineCap = "round";

  const bodyGradient = context.createLinearGradient(80, 180, 930, 500);
  bodyGradient.addColorStop(0, "rgba(19,64,75,.42)");
  bodyGradient.addColorStop(0.65, "rgba(26,96,101,.18)");
  bodyGradient.addColorStop(1, "rgba(20,113,106,.08)");
  context.fillStyle = bodyGradient;
  context.strokeStyle = "rgba(102,205,202,.46)";
  context.lineWidth = 2;
  context.beginPath();
  context.moveTo(62, 354);
  context.bezierCurveTo(174, 177, 388, 139, 594, 177);
  context.bezierCurveTo(739, 187, 848, 236, 961, 303);
  context.bezierCurveTo(852, 347, 767, 387, 718, 433);
  context.bezierCurveTo(592, 520, 334, 526, 162, 458);
  context.bezierCurveTo(108, 437, 77, 397, 62, 354);
  context.closePath();
  context.fill();
  context.stroke();

  context.strokeStyle = "rgba(122,194,196,.16)";
  context.lineWidth = 1;
  for (let offset = 0; offset < 7; offset += 1) {
    context.beginPath();
    context.moveTo(565 + offset * 18, 353 + offset * 5);
    context.quadraticCurveTo(670 + offset * 20, 411 + offset * 4, 788 + offset * 18, 379 + offset * 2);
    context.stroke();
  }

  context.fillStyle = `rgba(255,113,91,${0.1 + drive * 0.3})`;
  context.strokeStyle = "rgba(255,113,91,.38)";
  context.lineWidth = 1.5;
  context.beginPath();
  context.ellipse(275, 416, 105 + drive * 15, 62 + drive * 8, -0.06, 0, TAU);
  context.fill();
  context.stroke();
  context.beginPath();
  context.ellipse(358, 428, 86 + drive * 12, 53 + drive * 7, 0.08, 0, TAU);
  context.fill();
  context.stroke();
  drawFlow(context, [[352, 386], [410, 362], [472, 350], [520, 372]], "#ff715b", time, drive);

  context.fillStyle = `rgba(89,238,210,${0.08 + sac * 0.23})`;
  context.strokeStyle = `rgba(89,238,210,${0.25 + sac * 0.38})`;
  context.lineWidth = 1.5;
  context.beginPath();
  context.ellipse(445, 443, 58 + sac * 24, 42 + sac * 17, 0.06, 0, TAU);
  context.fill();
  context.stroke();
  drawFlow(context, [[515, 389], [487, 425], [444, 446], [414, 414], [461, 381], [512, 381]], "#59eed2", time, state.recycle, true);

  const larynxX = 532;
  const larynxY = 370;
  context.fillStyle = "rgba(255,191,74,.2)";
  context.strokeStyle = "rgba(255,191,74,.72)";
  context.lineWidth = 12;
  context.beginPath();
  context.arc(larynxX, larynxY, 46, 0.2, Math.PI - 0.2);
  context.stroke();
  context.fillStyle = "rgba(255,191,74,.16)";
  context.beginPath();
  context.ellipse(larynxX, larynxY - 30, 41, 20, 0, 0, TAU);
  context.fill();

  context.strokeStyle = `rgba(216,147,255,${0.36 + gesture.closure * 0.54})`;
  context.shadowColor = "#d893ff";
  context.shadowBlur = active * 18;
  context.lineWidth = 9;
  const separation = geometry.uFoldOpening * 8;
  context.beginPath();
  context.moveTo(larynxX - 37, larynxY - 1 - separation);
  context.quadraticCurveTo(larynxX - 8, larynxY + 11, larynxX, larynxY + 34);
  context.stroke();
  context.beginPath();
  context.moveTo(larynxX + 37, larynxY - 1 + separation);
  context.quadraticCurveTo(larynxX + 8, larynxY + 11, larynxX, larynxY + 34);
  context.stroke();
  context.shadowBlur = 0;

  context.fillStyle = "rgba(247,215,151,.44)";
  context.strokeStyle = "rgba(255,220,156,.64)";
  context.lineWidth = 1;
  context.beginPath();
  context.ellipse(larynxX, larynxY - 22 + gesture.closure * 5, 34, 15, 0, 0, TAU);
  context.fill();
  context.stroke();

  context.strokeStyle = "rgba(230,247,240,.58)";
  context.lineWidth = 3;
  context.beginPath();
  context.moveTo(490, 191);
  context.quadraticCurveTo(502, 181, 513, 190);
  context.moveTo(519, 191);
  context.quadraticCurveTo(531, 181, 542, 190);
  context.stroke();
  context.lineWidth = surfaceValveOpen ? 2.5 : 2;
  for (const center of [502, 530]) {
    context.beginPath();
    if (surfaceValveOpen) {
      context.fillStyle = "rgba(89,238,210,.22)";
      context.strokeStyle = "#59eed2";
      context.ellipse(center, 190, 10, 6, 0, 0, TAU);
      context.fill();
    } else {
      context.strokeStyle = "#ff715b";
      context.moveTo(center - 7, 184);
      context.lineTo(center + 7, 197);
      context.moveTo(center + 7, 184);
      context.lineTo(center - 7, 197);
    }
    context.stroke();
  }

  const bodyGlow = context.createRadialGradient(632, 405, 15, 632, 405, 150);
  bodyGlow.addColorStop(0, `rgba(199,255,67,${0.08 + focus * 0.22})`);
  bodyGlow.addColorStop(1, "rgba(89,238,210,0)");
  context.fillStyle = bodyGlow;
  context.beginPath();
  context.ellipse(635, 410, 142, 88, 0.1, 0, TAU);
  context.fill();
  for (let index = 0; index < 5; index += 1) {
    context.strokeStyle = `rgba(199,255,67,${0.06 + index * 0.018})`;
    context.beginPath();
    context.arc(585, 403, 27 + index * 19, -0.75, 0.82);
    context.stroke();
  }
  drawSoundBeam(context, 650, 414, time, active, focus, "mysticete");

  drawLabel(
    context,
    surfaceValveOpen ? "paired blowholes / open" : "paired blowholes / sealed underwater",
    421,
    132,
    516,
    190,
    surfaceValveOpen ? "rgba(89,238,210,.82)" : "rgba(255,113,91,.78)",
    "right",
  );
  drawLabel(context, "lungs", 176, 514, 279, 440, "rgba(255,113,91,.72)", "right");
  drawLabel(context, "laryngeal air sac", 355, 514, 437, 451, "rgba(89,238,210,.72)", "right");
  drawLabel(context, "U-fold arms", 573, 321, 537, 374, "rgba(216,147,255,.82)");
  drawLabel(context, "fat cushion", 620, 357, 552, 350, "rgba(255,220,156,.74)");
  drawLabel(context, "throat / body radiation", 735, 489, 647, 421, "rgba(199,255,67,.72)");

  drawHandle(context, "pressure", 236, 455 - state.pressure * 48, "#ff715b", "y");
  drawHandle(context, "recycle", 408 + state.recycle * 53, 454, "#59eed2", "x");
  drawHandle(context, "tension", 502 + state.tension * 58, 391, "#d893ff", "x");
  drawHandle(context, "focus", 586 + state.focus * 86, 435, "#c7ff43", "x");
  context.restore();
}

function drawStage(time = 0) {
  fitCanvas(stage, stageDrawing, stageMetrics, DESIGN_WIDTH, DESIGN_HEIGHT);
  const { cssWidth, cssHeight, pixelRatio, scale, offsetX, offsetY } = stageMetrics;
  stageDrawing.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
  stageDrawing.fillStyle = "#031016";
  stageDrawing.fillRect(0, 0, cssWidth, cssHeight);
  stageDrawing.save();
  stageDrawing.translate(offsetX, offsetY);
  stageDrawing.scale(scale, scale);

  const waterGradient = stageDrawing.createLinearGradient(0, 0, 0, DESIGN_HEIGHT);
  waterGradient.addColorStop(0, "#031116");
  waterGradient.addColorStop(0.55, "#061c24");
  waterGradient.addColorStop(1, "#04151c");
  stageDrawing.fillStyle = waterGradient;
  stageDrawing.fillRect(0, 0, DESIGN_WIDTH, DESIGN_HEIGHT);
  stageDrawing.strokeStyle = "rgba(109,194,195,.045)";
  stageDrawing.lineWidth = 1;
  for (let x = 0; x <= DESIGN_WIDTH; x += 50) {
    stageDrawing.beginPath();
    stageDrawing.moveTo(x, 0);
    stageDrawing.lineTo(x, DESIGN_HEIGHT);
    stageDrawing.stroke();
  }
  for (let y = 0; y <= DESIGN_HEIGHT; y += 50) {
    stageDrawing.beginPath();
    stageDrawing.moveTo(0, y);
    stageDrawing.lineTo(DESIGN_WIDTH, y);
    stageDrawing.stroke();
  }

  const phase = displayPhase();
  const call = currentCall();
  const gesture = evaluateBlowholeGesture(call, phase, state);
  const geometry = deriveBlowholeGeometry(state, phase);
  const surfaceValveOpen = venting || telemetry.valveOpen;
  stageHandles = [];
  if (call.id === "sperm-whale-coda") {
    drawSpermWhale(stageDrawing, geometry, gesture, time, surfaceValveOpen);
  } else if (call.family === "odontocete") {
    drawDolphin(stageDrawing, geometry, gesture, time, surfaceValveOpen);
  } else {
    drawBaleenWhale(stageDrawing, geometry, gesture, time, surfaceValveOpen);
  }
  stageDrawing.restore();
}

function normalizedLanePoints(call, key) {
  const points = call.lanes[key] ?? [[0, 0], [1, 0]];
  return points.map((point) => [clamp(point[0]), clamp(point[1])]);
}

function drawTimeline() {
  fitCanvas(timeline, timelineDrawing, timelineMetrics);
  const { cssWidth: width, cssHeight: height, pixelRatio } = timelineMetrics;
  timelineDrawing.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
  timelineDrawing.fillStyle = "#041219";
  timelineDrawing.fillRect(0, 0, width, height);
  const call = currentCall();
  const labelWidth = 105;
  const rightPadding = 18;
  const topPadding = 12;
  const bottomPadding = 18;
  const graphWidth = Math.max(1, width - labelWidth - rightPadding);
  const laneGap = 5;
  const laneHeight = (height - topPadding - bottomPadding - laneGap * 3) / 4;
  const clickRateLane = /click|buzz|coda/.test(call.register);
  const laneDefinitions = [
    { key: "pressure", label: "PRESSURE", color: "#ff715b" },
    {
      key: clickRateLane ? "pulseRate" : "frequency",
      label: call.pulseLockedToFundamental
        ? "M1 F0 / RATE"
        : clickRateLane ? "CLICK RATE" : "FREQUENCY",
      color: "#ffbf4a",
    },
    { key: "closure", label: "CLOSURE", color: "#d893ff" },
    { key: "focus", label: "FOCUS", color: "#59eed2" },
  ];
  const gesture = evaluateBlowholeGesture(call, displayPhase(), state);

  timelineDrawing.font = "700 9px ui-monospace, SFMono-Regular, Menlo, monospace";
  for (let laneIndex = 0; laneIndex < laneDefinitions.length; laneIndex += 1) {
    const definition = laneDefinitions[laneIndex];
    const top = topPadding + laneIndex * (laneHeight + laneGap);
    timelineDrawing.fillStyle = laneIndex % 2
      ? "rgba(12,39,47,.48)"
      : "rgba(7,29,37,.62)";
    timelineDrawing.fillRect(labelWidth, top, graphWidth, laneHeight);
    timelineDrawing.strokeStyle = "rgba(135,204,204,.1)";
    timelineDrawing.lineWidth = 1;
    timelineDrawing.strokeRect(labelWidth + 0.5, top + 0.5, graphWidth - 1, laneHeight - 1);
    timelineDrawing.strokeStyle = "rgba(135,204,204,.08)";
    timelineDrawing.beginPath();
    timelineDrawing.moveTo(labelWidth, top + laneHeight * 0.5);
    timelineDrawing.lineTo(labelWidth + graphWidth, top + laneHeight * 0.5);
    timelineDrawing.stroke();
    timelineDrawing.fillStyle = definition.color;
    timelineDrawing.globalAlpha = 0.8;
    timelineDrawing.textAlign = "right";
    timelineDrawing.fillText(definition.label, labelWidth - 12, top + laneHeight * 0.5 + 3);
    timelineDrawing.globalAlpha = 1;

    const points = normalizedLanePoints(call, definition.key);
    timelineDrawing.strokeStyle = definition.color;
    timelineDrawing.lineWidth = 1.6;
    timelineDrawing.shadowColor = definition.color;
    timelineDrawing.shadowBlur = 7;
    timelineDrawing.beginPath();
    points.forEach(([pointPhase, value], index) => {
      const x = labelWidth + pointPhase * graphWidth;
      const y = top + 4 + (1 - value) * Math.max(1, laneHeight - 8);
      if (index) timelineDrawing.lineTo(x, y);
      else timelineDrawing.moveTo(x, y);
    });
    timelineDrawing.stroke();
    timelineDrawing.shadowBlur = 0;
    for (const [pointPhase, value] of points) {
      const x = labelWidth + pointPhase * graphWidth;
      const y = top + 4 + (1 - value) * Math.max(1, laneHeight - 8);
      timelineDrawing.save();
      timelineDrawing.translate(x, y);
      timelineDrawing.rotate(Math.PI * 0.25);
      timelineDrawing.fillStyle = "#06151b";
      timelineDrawing.strokeStyle = definition.color;
      timelineDrawing.lineWidth = 1.2;
      timelineDrawing.fillRect(-3.5, -3.5, 7, 7);
      timelineDrawing.strokeRect(-3.5, -3.5, 7, 7);
      timelineDrawing.restore();
    }
    const currentValue = definition.key === "pulseRate" ? gesture.pulseRate : gesture[definition.key];
    const currentX = labelWidth + displayPhase() * graphWidth;
    const currentY = top + 4 + (1 - clamp(currentValue)) * Math.max(1, laneHeight - 8);
    timelineDrawing.fillStyle = definition.color;
    timelineDrawing.beginPath();
    timelineDrawing.arc(currentX, currentY, 3.4, 0, TAU);
    timelineDrawing.fill();
  }

  if (call.pulseTimes.length) {
    timelineDrawing.strokeStyle = "rgba(199,255,67,.36)";
    timelineDrawing.setLineDash([2, 5]);
    for (const pulsePhase of call.pulseTimes) {
      const x = labelWidth + pulsePhase * graphWidth;
      timelineDrawing.beginPath();
      timelineDrawing.moveTo(x, topPadding);
      timelineDrawing.lineTo(x, height - bottomPadding);
      timelineDrawing.stroke();
    }
    timelineDrawing.setLineDash([]);
  }

  const playheadX = labelWidth + displayPhase() * graphWidth;
  timelineDrawing.strokeStyle = "#c7ff43";
  timelineDrawing.shadowColor = "rgba(199,255,67,.75)";
  timelineDrawing.shadowBlur = 8;
  timelineDrawing.lineWidth = 1.2;
  timelineDrawing.beginPath();
  timelineDrawing.moveTo(playheadX, 4);
  timelineDrawing.lineTo(playheadX, height - 7);
  timelineDrawing.stroke();
  timelineDrawing.shadowBlur = 0;
  timelineDrawing.fillStyle = "#c7ff43";
  timelineDrawing.beginPath();
  timelineDrawing.moveTo(playheadX, 3);
  timelineDrawing.lineTo(playheadX - 5, 10);
  timelineDrawing.lineTo(playheadX + 5, 10);
  timelineDrawing.closePath();
  timelineDrawing.fill();
  timelineDrawing.fillStyle = "rgba(172,207,205,.6)";
  timelineDrawing.textAlign = "center";
  for (let tick = 0; tick <= 4; tick += 1) {
    const fraction = tick / 4;
    const x = labelWidth + fraction * graphWidth;
    timelineDrawing.fillText(`${(fraction * call.durationMs / 1_000).toFixed(1)}s`, x, height - 5);
  }
}

function animate(time) {
  drawStage(time);
  drawTimeline();
  updateReadouts();
  animationFrame = requestAnimationFrame(animate);
}

function startStageDrag(event) {
  if (event.button !== 0) return;
  const point = stagePoint(event);
  let closest = null;
  let closestDistance = Infinity;
  for (const handle of stageHandles) {
    const distance = Math.hypot(point.x - handle.x, point.y - handle.y);
    if (distance <= handle.radius && distance < closestDistance) {
      closest = handle;
      closestDistance = distance;
    }
  }
  if (!closest) return;
  event.preventDefault();
  stage.setPointerCapture?.(event.pointerId);
  pointerDrag = {
    ...closest,
    pointerId: event.pointerId,
    startX: point.x,
    startY: point.y,
    startValue: state[closest.key],
  };
}

function moveStageDrag(event) {
  if (!pointerDrag || event.pointerId !== pointerDrag.pointerId) return;
  event.preventDefault();
  const point = stagePoint(event);
  const delta = pointerDrag.axis === "y"
    ? (pointerDrag.startY - point.y) / 150
    : (point.x - pointerDrag.startX) / 170;
  const limits = BLOWHOLE_LIMITS[pointerDrag.key] ?? [0, 1];
  setStateValue(pointerDrag.key, clamp(pointerDrag.startValue + delta, limits[0], limits[1]));
}

function endStageDrag(event) {
  if (!pointerDrag || event.pointerId !== pointerDrag.pointerId) return;
  const key = pointerDrag.key;
  pointerDrag = null;
  stage.releasePointerCapture?.(event.pointerId);
  setStateValue(key, state[key], { announceState: true });
}

function installEvents() {
  $("audioButton").addEventListener("click", toggleAudio);
  $("playButton").addEventListener("click", toggleCall);
  $("loopButton").addEventListener("click", () => setLoop(!looping));
  $("ventButton").addEventListener("click", ventSurfaceBreath);
  $("resetButton").addEventListener("click", resetAll);
  $("callSelect").addEventListener("change", (event) => setCall(event.target.value));
  for (const tab of document.querySelectorAll(".blowhole-family-tabs [data-family]")) {
    tab.addEventListener("click", () => setFamily(tab.dataset.family));
  }
  for (const spec of CONTROL_SPECS) {
    const input = $(spec.key);
    input?.addEventListener("input", () => setStateValue(spec.key, Number(input.value)));
    input?.addEventListener("change", () => setStateValue(spec.key, Number(input.value), { announceState: true }));
  }
  $("monitorMode").addEventListener("change", (event) => {
    state = sanitizeBlowholeState({ ...state, monitorMode: event.target.value }, state);
    postConfiguration();
    syncControls();
    announce(state.monitorMode === "audible"
      ? "Audible monitor maps frequency extremes while preserving the physical readout"
      : "Physical monitor selected; browser and speaker bandwidth still apply");
  });

  const holdPad = $("holdPad");
  holdPad.addEventListener("pointerdown", (event) => {
    event.preventDefault();
    holdPad.setPointerCapture?.(event.pointerId);
    startManual("pointer");
  });
  holdPad.addEventListener("pointerup", () => stopManual("pointer"));
  holdPad.addEventListener("pointercancel", () => stopManual("pointer"));
  holdPad.addEventListener("lostpointercapture", () => stopManual("pointer"));
  holdPad.addEventListener("keydown", (event) => {
    if (event.code !== "Space" && event.key !== "Enter") return;
    event.preventDefault();
    if (!event.repeat) startManual("keyboard");
  });
  holdPad.addEventListener("keyup", (event) => {
    if (event.code !== "Space" && event.key !== "Enter") return;
    event.preventDefault();
    stopManual("keyboard");
  });

  stage.addEventListener("pointerdown", startStageDrag);
  stage.addEventListener("pointermove", moveStageDrag);
  stage.addEventListener("pointerup", endStageDrag);
  stage.addEventListener("pointercancel", endStageDrag);

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      stopPerformance();
      return;
    }
    const target = event.target;
    const ownsKeyboard = target?.closest?.(
      "input, select, textarea, button, a[href], summary, [contenteditable], [role='button'], [role='tab'], [role='slider']",
    );
    if (ownsKeyboard || target?.isContentEditable) return;
    if (event.code === "Space") {
      event.preventDefault();
      if (!event.repeat) toggleCall();
      return;
    }
    if (event.key.toLowerCase() === "b") {
      event.preventDefault();
      if (!event.repeat) startManual("keyboard");
      return;
    }
    const number = Number(event.key);
    if (Number.isInteger(number) && number >= 1 && number <= BLOWHOLE_CALLS.length) {
      event.preventDefault();
      setCall(BLOWHOLE_CALLS[number - 1].id);
    }
  });
  document.addEventListener("keyup", (event) => {
    if (event.key.toLowerCase() === "b") stopManual("keyboard");
  });
  globalThis.addEventListener("blur", () => stopManual());
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) {
      stopPerformance({ announceState: false });
      graph?.sourceNode?.port.postMessage({ type: "silence" });
    }
  });
  globalThis.addEventListener("pagehide", (event) => {
    if (event.persisted) return;
    pageIsActive = false;
    pageLifecycleGeneration += 1;
    playIntent += 1;
    cancelAnimationFrame(animationFrame);
    animationFrame = 0;
    const closingGraph = graph;
    const closingContext = audioContext;
    graph = null;
    audioContext = null;
    audioStartupPromise = null;
    closingGraph?.sourceNode?.port.postMessage({ type: "silence" });
    closingGraph?.releaseOutput?.();
    void closingContext?.close?.();
  });
}

syncLimits();
buildCallSelect();
$("callSelect").value = state.callId;
$("callDescription").textContent = currentCall().description;
updateFamilyCopy();
buildCallButtons();
syncControls();
updateTransportPresentation();
installEvents();
new ResizeObserver(() => {
  drawStage(performance.now());
  drawTimeline();
}).observe(stageWrap);
animationFrame = requestAnimationFrame(animate);

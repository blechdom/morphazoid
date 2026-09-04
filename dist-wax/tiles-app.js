import {
  VoicePool,
  clamp,
  mapCurve01,
  pitch01ToFrequency,
  synthParametersForMode,
} from "./src/audio.js";
import {
  cloneDefaultFmDrumVoices,
  FmDrumAudio,
} from "./src/fm-drums.js";
import {
  TILING_TYPES,
  buildLattice,
  centeredContactWindow,
  contactsForLine,
  createScanLine,
  edgeShapeName,
  evenlySelectContacts,
  latticeContactOnsetKey,
  latticeOffsetForPhase,
  newlyEnteredLatticeContacts,
  tilingInfo,
  tilingParameterRange,
} from "./src/lattice.js";
import {
  angleShapePitchForSpiralContact,
  buildSpiralTessellation,
  contactsForSpiralReader,
  createSpiralReader,
  phaseForSpiralPoint,
  scaleRateForSpiralRadius,
  shapePitchForSpiralContact,
} from "./src/spiral.js";
import {
  LATTICE_DRUM_MAPPING_MODES,
  latticeDrumVoiceIndex,
  mappedLatticeDrumVoice,
} from "./src/lattice-drums.js";
import {
  SPIRAL_DRUM_MAPPING_MODES,
  mappedSpiralDrumVoice,
  spiralDrumVoiceIndex,
} from "./src/spiral-drums.js";
import { emitMidiOutputPreview } from "./src/midi-output-preview.js";
import { TILES_APP_MODES, tilesModeFor } from "./src/tiles-suite.js";

const TAU = Math.PI * 2;
const MIDI_PREVIEW_ROUTE_ID = "tiles-app-preview";
const DRUM_REENTRY_MS = 75;
const LATTICE_BOUNDS = Object.freeze({ minX: -1.16, minY: -0.92, maxX: 1.16, maxY: 0.92 });
const SPIRAL_BOUNDS = Object.freeze({ innerRadius: 0.045, outerRadius: 1.08 });
const TILE_COLORS = Object.freeze([
  "rgba(103, 233, 189, .18)",
  "rgba(120, 167, 255, .17)",
  "rgba(255, 181, 111, .16)",
  "rgba(215, 239, 127, .15)",
]);
const EDGE_COLORS = Object.freeze([
  "rgba(240, 255, 248, .38)",
  "rgba(103, 233, 189, .52)",
  "rgba(120, 167, 255, .52)",
  "rgba(255, 181, 111, .5)",
]);
const LATTICE_PITCH_SOURCES = Object.freeze([
  ["height", "Height"],
  ["along", "Along reader"],
  ["incidence", "Incidence"],
  ["orientation", "Orientation"],
]);
const SPIRAL_PITCH_SOURCES = Object.freeze([
  ["angle-shape", "Angle + shape"],
  ["shape", "Tile shape"],
  ["angle", "Angle"],
  ["reader", "Reader path"],
  ["orientation", "Orientation"],
  ["radius", "Radius"],
]);

const $ = (id) => document.getElementById(id);
const synthPool = new VoicePool(128, { adaptive: true, maxVoices: 4096 });
const drumAudio = new FmDrumAudio(globalThis);
const drumVoices = cloneDefaultFmDrumVoices();

const defaultInfo = tilingInfo(20);
const state = {
  mode: "lattice",
  tilingType: defaultInfo.type,
  parameters: [...defaultInfo.defaultParameters],
  edgeCurves: Array.from({ length: defaultInfo.edgeShapes.length }, () => 0),
  density: 0.52,
  position: 0.5,
  continuousPosition: 0.5,
  speed: 0.12,
  traversalDirection: 1,
  motionMode: "loop",
  playing: false,
  audio: false,
  level: 0.62,
  lineAngle: 90,
  patternAngle: 0,
  timePath: "radius",
  readerTurns: 2,
  sizeCoupling: false,
  spiralA: 1,
  spiralB: 5,
  loopPhase: 0,
  pitchSourceByGeometry: {
    lattice: "height",
    spiral: "angle-shape",
  },
  soundMode: "sine",
  baseFrequency: 110,
  pitchRange: 3.5,
  contactLevel: 0.35,
  stereoWidth: 0.72,
  fmIndex: 3,
  pmIndex: 2,
  latticeMappingMode: "edge-angle",
  spiralMappingMode: "radius-angle",
  pitchDepth: 12,
  characterDepth: 0.7,
  strikeLimit: 5,
};

let lattice = null;
let tessellation = null;
let geometryDirty = true;
let scheduledFrame = 0;
let lastFrameTime = performance.now();
let previousContactKeys = new Set();
let midiPreviewContactKeys = new Set();
let lastStrikeTimes = new Map();
let lastPreviewStrikeTimes = new Map();
let activeDrumIndex = -1;
const contactAges = new Map();
const pointer = { active: false };

function wrap01(value) {
  return ((value % 1) + 1) % 1;
}

function pingPong01(value) {
  const wrapped = ((value % 2) + 2) % 2;
  return wrapped <= 1 ? wrapped : 2 - wrapped;
}

function pct(value) {
  return `${Math.round(clamp(value, 0, 1) * 100)}%`;
}

function modeInfo() {
  return tilesModeFor(state.mode);
}

function isSpiralMode() {
  return modeInfo().geometryKind === "spiral";
}

function isDrumMode() {
  return modeInfo().audioKind === "drums";
}

function activePitchSource() {
  return state.pitchSourceByGeometry[modeInfo().geometryKind] ?? "height";
}

function tileScaleForDensity() {
  return 0.52 - clamp(state.density, 0, 1) * 0.36;
}

function spiralTileBudget() {
  return Math.round(220 + clamp(state.density, 0, 1) * 980);
}

function currentMappingMode() {
  return isSpiralMode() ? state.spiralMappingMode : state.latticeMappingMode;
}

function setCurrentMappingMode(value) {
  if (isSpiralMode()) state.spiralMappingMode = value;
  else state.latticeMappingMode = value;
}

function announce(message) {
  const live = $("liveStatus");
  if (live) live.textContent = message;
}

function showError(error) {
  const message = error?.message ?? String(error ?? "Unknown audio error");
  $("audioError").hidden = false;
  $("audioError").textContent = message;
  announce(message);
}

function clearError() {
  $("audioError").hidden = true;
  $("audioError").textContent = "";
}

function nearestMidiNote(frequencyHz) {
  return Math.round(clamp(69 + 12 * Math.log2(frequencyHz / 440), 0, 127));
}

function emitPreview(detail) {
  return emitMidiOutputPreview({ ...detail, routeId: MIDI_PREVIEW_ROUTE_ID });
}

function scheduleFrame() {
  if (!scheduledFrame) scheduledFrame = requestAnimationFrame(frame);
}

function rebuildLattice() {
  lattice = buildLattice({
    type: state.tilingType,
    parameters: state.parameters,
    edgeCurves: state.edgeCurves,
    scale: tileScaleForDensity(),
    bounds: LATTICE_BOUNDS,
    alignPeriodToDegrees: state.patternAngle + 180,
  });
}

function rebuildSpiral() {
  tessellation = buildSpiralTessellation({
    type: state.tilingType,
    parameters: state.parameters,
    edgeCurves: state.edgeCurves,
    spiralA: state.spiralA,
    spiralB: state.spiralB,
    loopPhase: state.loopPhase,
    angleOffset: (state.lineAngle / 180) * Math.PI,
    innerRadius: SPIRAL_BOUNDS.innerRadius,
    outerRadius: SPIRAL_BOUNDS.outerRadius,
    maxTiles: spiralTileBudget(),
  });
}

function rebuildGeometry() {
  try {
    rebuildLattice();
    rebuildSpiral();
    geometryDirty = false;
  } catch (error) {
    showError(error);
  }
}

function latticeContactsForState() {
  if (!lattice) rebuildLattice();
  const scan = createScanLine(LATTICE_BOUNDS, state.position, state.lineAngle);
  const offset = latticeOffsetForPhase(lattice, state.position);
  return {
    scan,
    offset,
    contacts: contactsForLine(lattice, scan, lattice.scale * 0.018, offset),
  };
}

function spiralContactsForState() {
  if (!tessellation) rebuildSpiral();
  const reader = createSpiralReader({
    ...tessellation.bounds,
    mode: state.timePath,
    phase: state.position,
    turns: state.readerTurns,
    sizeCoupled: state.sizeCoupling,
  });
  return {
    reader,
    contacts: contactsForSpiralReader(tessellation, reader),
  };
}

function normalizedLatticeContact(contact) {
  const width = Math.max(1e-9, LATTICE_BOUNDS.maxX - LATTICE_BOUNDS.minX);
  const height = Math.max(1e-9, LATTICE_BOUNDS.maxY - LATTICE_BOUNDS.minY);
  return {
    x: clamp((contact.x - LATTICE_BOUNDS.minX) / width, 0, 1),
    y: clamp((contact.y - LATTICE_BOUNDS.minY) / height, 0, 1),
  };
}

function contactAge(contact) {
  const key = contact.voiceKey ?? contact.edgeKey ?? `${contact.x}:${contact.y}`;
  return contactAges.get(key) ?? 0;
}

function updateContactAges(contacts, delta) {
  const liveKeys = new Set();
  for (const contact of contacts) {
    const key = contact.voiceKey ?? contact.edgeKey ?? `${contact.x}:${contact.y}`;
    liveKeys.add(key);
    contactAges.set(key, (contactAges.get(key) ?? 0) + delta);
  }
  for (const key of contactAges.keys()) {
    if (!liveKeys.has(key)) contactAges.delete(key);
  }
}

function latticePitchMark(contact) {
  const source = activePitchSource();
  if (source === "along") return contact.along01;
  if (source === "incidence") return contact.incidence;
  if (source === "orientation") return contact.orientation;
  return normalizedLatticeContact(contact).y;
}

function spiralPitchMark(contact) {
  const source = activePitchSource();
  if (source === "shape") return shapePitchForSpiralContact(contact);
  if (source === "angle") return contact.angle01;
  if (source === "reader") return contact.along01;
  if (source === "orientation") return contact.orientation;
  if (source === "radius") {
    const span = Math.max(1e-9, tessellation.logOuter - tessellation.logInner);
    return clamp((Math.log(contact.radius) - tessellation.logInner) / span, 0, 1);
  }
  return angleShapePitchForSpiralContact(contact);
}

function shepardRateForContact(contact) {
  if (!state.playing) return 0;
  const direction = state.motionMode === "ping-pong"
    ? (state.continuousPosition % 2 + 2) % 2 <= 1 ? state.traversalDirection : -state.traversalDirection
    : state.traversalDirection;
  const sizeRate = isSpiralMode() && state.sizeCoupling
    ? scaleRateForSpiralRadius(contact.radius, tessellation.bounds.innerRadius, tessellation.bounds.outerRadius)
    : 1;
  return state.speed * direction * sizeRate;
}

function synthForContact(contact, pitchMark) {
  return synthParametersForMode(state.soundMode, contact.incidence ?? pitchMark, {
    fmIndex: state.fmIndex,
    fmRatio: 2,
    pmIndex: state.pmIndex,
    pmRatio: 1,
    shepardRate: shepardRateForContact(contact),
    shepardWidth: 4,
  });
}

function voiceForLatticeContact(contact) {
  const normalized = normalizedLatticeContact(contact);
  const pitchMark = mapCurve01(latticePitchMark(contact), "smooth");
  const levelMark = mapCurve01(contact.incidence, "smooth");
  const age = contactAge(contact);
  const attack = Math.min(1, age / 0.08);
  return {
    key: `tiles:lattice:${contact.voiceKey}`,
    frequency: pitch01ToFrequency(pitchMark, state.baseFrequency, state.pitchRange),
    gain: state.contactLevel * 0.14 * (0.22 + 0.78 * levelMark) * attack,
    pan: (normalized.x * 2 - 1) * state.stereoWidth,
    ...synthForContact(contact, pitchMark),
  };
}

function voiceForSpiralContact(contact) {
  const pitchMark = mapCurve01(spiralPitchMark(contact), "smooth");
  const sizeRate = state.sizeCoupling
    ? scaleRateForSpiralRadius(
      contact.radius,
      tessellation.bounds.innerRadius,
      tessellation.bounds.outerRadius,
    )
    : 1;
  const pitchScale = state.sizeCoupling && activePitchSource() === "radius"
    ? Math.sqrt(sizeRate)
    : sizeRate;
  const age = contactAge(contact) * sizeRate;
  const attack = Math.min(1, age / 0.08);
  return {
    key: `tiles:spiral:${contact.voiceKey}`,
    frequency: pitch01ToFrequency(pitchMark, state.baseFrequency, state.pitchRange) * pitchScale,
    gain: state.contactLevel * 0.13 * (0.25 + 0.75 * contact.incidence) * attack,
    pan: clamp(contact.x / tessellation.bounds.outerRadius, -1, 1) * state.stereoWidth,
    ...synthForContact(contact, pitchMark),
  };
}

function currentSynthVoices(contacts) {
  const selected = isSpiralMode()
    ? evenlySelectContacts(contacts, 96)
    : centeredContactWindow(contacts, 96);
  return selected.map((contact) => (
    isSpiralMode() ? voiceForSpiralContact(contact) : voiceForLatticeContact(contact)
  ));
}

function currentDrumVoice(contact, voiceIndex, contactCount) {
  const baseVoice = drumVoices[voiceIndex % drumVoices.length];
  return isSpiralMode()
    ? mappedSpiralDrumVoice(baseVoice, contact, {
      bounds: tessellation.bounds,
      pitchDepth: state.pitchDepth,
      characterDepth: state.characterDepth,
      contactCount,
    })
    : mappedLatticeDrumVoice(baseVoice, contact, {
      bounds: LATTICE_BOUNDS,
      pitchDepth: state.pitchDepth,
      characterDepth: state.characterDepth,
      contactCount,
    });
}

function drumVoiceIndex(contact, contactCount) {
  return isSpiralMode()
    ? spiralDrumVoiceIndex(contact, {
      mode: state.spiralMappingMode,
      bounds: tessellation.bounds,
      contactCount,
    })
    : latticeDrumVoiceIndex(contact, {
      mode: state.latticeMappingMode,
      bounds: LATTICE_BOUNDS,
      contactCount,
      densityCeiling: Math.max(8, Math.round(8 + state.density * 24)),
    });
}

function notePreviewForDrum(contact, voiceIndex, voice) {
  emitPreview({
    kind: "note",
    source: isSpiralMode() ? "Tiles spiral drum crossing" : "Tiles lattice drum crossing",
    sourceId: isSpiralMode() ? "tiles-spiral-drum" : "tiles-lattice-drum",
    voiceId: `tiles:${state.mode}:${contact.voiceKey ?? contact.edgeKey}`,
    channel: 10,
    note: 36 + voiceIndex,
    velocity: Math.max(1, Math.round(clamp(voice.level, 0, 1) * 127)),
    durationMs: Math.max(1, Math.round(((voice.attack || 0) + (voice.decay || 0.1)) * 1000)),
  });
}

function notePreviewForSynth(contact, voice) {
  emitPreview({
    kind: "note",
    source: isSpiralMode() ? "Tiles spiral crossing" : "Tiles lattice crossing",
    sourceId: isSpiralMode() ? "tiles-spiral-synth" : "tiles-lattice-synth",
    voiceId: voice.key,
    channel: 1,
    note: nearestMidiNote(voice.frequency),
    frequencyHz: voice.frequency,
    velocity: Math.max(1, Math.round(clamp(voice.gain * 4, 0, 1) * 127)),
    durationMs: 180,
  });
}

function currentContactKeys(contacts) {
  if (isSpiralMode()) return new Set(contacts.map((contact) => contact.voiceKey));
  return new Set(contacts.map((contact) => latticeContactOnsetKey(contact)));
}

function contactOnsets(contacts, previousKeys) {
  return isSpiralMode()
    ? contacts.filter((contact) => !previousKeys.has(contact.voiceKey))
    : newlyEnteredLatticeContacts(contacts, previousKeys);
}

function triggerDrums(contacts, now) {
  if (!state.playing) return;
  const onsets = contactOnsets(contacts, previousContactKeys);
  let emitted = 0;
  for (const contact of onsets) {
    if (emitted >= state.strikeLimit) break;
    const index = drumVoiceIndex(contact, contacts.length);
    const lastStrike = lastStrikeTimes.get(index) ?? Number.NEGATIVE_INFINITY;
    if (now - lastStrike < DRUM_REENTRY_MS) continue;
    lastStrikeTimes.set(index, now);
    activeDrumIndex = index;
    const voice = currentDrumVoice(contact, index, contacts.length);
    notePreviewForDrum(contact, index, voice);
    if (state.audio) drumAudio.trigger(voice).catch(showError);
    emitted += 1;
  }
}

function previewSynthOnsets(contacts, voices, now) {
  if (!state.playing || state.audio) return;
  const onsets = contactOnsets(contacts, midiPreviewContactKeys);
  for (const contact of centeredContactWindow(onsets, 8)) {
    const key = contact.voiceKey ?? contact.edgeKey;
    const last = lastPreviewStrikeTimes.get(key) ?? Number.NEGATIVE_INFINITY;
    if (now - last < 160) continue;
    lastPreviewStrikeTimes.set(key, now);
    const voice = voices.find((candidate) => candidate.key.includes(String(key)))
      ?? (isSpiralMode() ? voiceForSpiralContact(contact) : voiceForLatticeContact(contact));
    notePreviewForSynth(contact, voice);
  }
}

function previewDrumOnsets(contacts, now) {
  if (!state.playing || state.audio) return;
  const onsets = contactOnsets(contacts, midiPreviewContactKeys);
  let emitted = 0;
  for (const contact of onsets) {
    if (emitted >= state.strikeLimit) break;
    const index = drumVoiceIndex(contact, contacts.length);
    const lastStrike = lastPreviewStrikeTimes.get(index) ?? Number.NEGATIVE_INFINITY;
    if (now - lastStrike < DRUM_REENTRY_MS) continue;
    lastPreviewStrikeTimes.set(index, now);
    const voice = currentDrumVoice(contact, index, contacts.length);
    notePreviewForDrum(contact, index, voice);
    emitted += 1;
  }
}

function silenceAudioRoutes(rampMilliseconds = 45) {
  synthPool.setHostGain(0, rampMilliseconds);
  drumAudio.setHostGain(0, rampMilliseconds);
  synthPool.silence();
}

async function prepareActiveAudio() {
  silenceAudioRoutes();
  if (isDrumMode()) {
    await drumAudio.start();
    drumAudio.setOutput(state.level);
    drumAudio.setHostGain(1, 45);
    synthPool.setLevel(0);
    return;
  }
  await synthPool.enable();
  synthPool.setLevel(state.level);
  synthPool.setHostGain(1, 45);
  drumAudio.setHostGain(0, 45);
}

function updateAudioLevel() {
  synthPool.setLevel(isDrumMode() ? 0 : state.level);
  drumAudio.setOutput(isDrumMode() ? state.level : 0);
}

async function setAudioEnabled(enabled) {
  state.audio = Boolean(enabled);
  clearError();
  try {
    if (state.audio) await prepareActiveAudio();
    else silenceAudioRoutes();
  } catch (error) {
    state.audio = false;
    showError(error);
  }
  renderControls();
  scheduleFrame();
}

async function setMode(modeId) {
  const nextMode = tilesModeFor(modeId).id;
  if (nextMode === state.mode) return;
  const previousMode = state.mode;
  state.mode = nextMode;
  previousContactKeys = new Set();
  midiPreviewContactKeys = new Set();
  activeDrumIndex = -1;
  clearError();
  try {
    if (state.audio) await prepareActiveAudio();
  } catch (error) {
    state.mode = previousMode;
    let restored = false;
    try {
      if (state.audio) {
        await prepareActiveAudio();
        restored = true;
      }
    } catch {
      await setAudioEnabled(false);
    }
    showError(restored ? error : new Error(`${error?.message ?? error} Audio was turned off.`));
  }
  renderControls();
  announce(`${tilesModeFor(state.mode).label} selected.`);
  scheduleFrame();
}

function syncInput(id, value) {
  const input = $(id);
  if (input && input.type !== "checkbox") input.value = String(value);
}

function syncCheckbox(id, checked) {
  const input = $(id);
  if (input) input.checked = Boolean(checked);
}

function setPressed(element, pressed) {
  element?.setAttribute("aria-pressed", String(Boolean(pressed)));
}

function renderModeSwitch() {
  $("tilesApp").dataset.tilesMode = state.mode;
  for (const button of $("tilesMode").querySelectorAll("[data-tiles-mode]")) {
    const selected = button.dataset.tilesMode === state.mode;
    button.setAttribute("aria-selected", String(selected));
    button.tabIndex = selected ? 0 : -1;
  }
  const mode = modeInfo();
  for (const bank of document.querySelectorAll("[data-mode-bank]")) {
    const active = bank.dataset.modeBank === mode.audioKind;
    bank.hidden = !active;
    bank.classList.toggle("is-active", active);
  }
  for (const bank of document.querySelectorAll("[data-geometry-bank]")) {
    const active = bank.dataset.geometryBank === mode.geometryKind;
    bank.hidden = !active;
    bank.classList.toggle("is-active", active);
  }
  $("synthBank").setAttribute("aria-labelledby", mode.audioKind === "synth" && state.mode === "spiral" ? "modeSpiral" : "modeLattice");
  $("drumsBank").setAttribute("aria-labelledby", state.mode === "spiral-drums" ? "modeSpiralDrums" : "modeLatticeDrums");
}

function renderPitchSources() {
  const select = $("pitchSource");
  const options = isSpiralMode() ? SPIRAL_PITCH_SOURCES : LATTICE_PITCH_SOURCES;
  const value = activePitchSource();
  select.replaceChildren(...options.map(([id, label]) => {
    const option = document.createElement("option");
    option.value = id;
    option.textContent = label;
    return option;
  }));
  select.value = options.some(([id]) => id === value) ? value : options[0][0];
  state.pitchSourceByGeometry[modeInfo().geometryKind] = select.value;
}

function renderMappingSources() {
  const select = $("mappingMode");
  const options = isSpiralMode() ? SPIRAL_DRUM_MAPPING_MODES : LATTICE_DRUM_MAPPING_MODES;
  select.replaceChildren(...options.map(({ id, label }) => {
    const option = document.createElement("option");
    option.value = id;
    option.textContent = label;
    return option;
  }));
  const value = currentMappingMode();
  select.value = options.some(({ id }) => id === value) ? value : options[0].id;
  setCurrentMappingMode(select.value);
}

function renderTileControls() {
  const info = tilingInfo(state.tilingType);
  const parameterControls = $("parameterControls");
  parameterControls.replaceChildren();
  if (!info.defaultParameters.length) {
    const placeholder = document.createElement("div");
    placeholder.className = "tiles-parameter-placeholder tiles-wide";
    placeholder.textContent = "No variable tile parameters";
    parameterControls.append(placeholder);
  }
  info.defaultParameters.forEach((_, index) => {
    const range = tilingParameterRange(info.type, index);
    const label = document.createElement("label");
    label.className = "control";
    label.htmlFor = `tileParameter${index}`;
    label.innerHTML = `<span><b>Parameter ${index + 1}</b><output id="tileParameter${index}Out" for="tileParameter${index}"></output></span>`;
    const input = document.createElement("input");
    input.id = `tileParameter${index}`;
    input.type = "range";
    input.min = String(range.min);
    input.max = String(range.max);
    input.step = "0.001";
    input.value = String(state.parameters[index] ?? info.defaultParameters[index]);
    input.addEventListener("input", () => {
      state.parameters[index] = Number(input.value);
      geometryDirty = true;
      updateDynamicOutputs();
      scheduleFrame();
    });
    label.append(input);
    parameterControls.append(label);
  });

  const edgeControls = $("edgeControls");
  edgeControls.replaceChildren();
  info.edgeShapes.forEach((shape, index) => {
    const rigid = edgeShapeName(shape) === "I";
    const label = document.createElement("label");
    label.className = "control";
    label.htmlFor = `edgeCurve${index}`;
    label.innerHTML = `<span><b>Edge ${String.fromCharCode(65 + index)}</b><output id="edgeCurve${index}Out" for="edgeCurve${index}"></output></span>`;
    label.title = `${edgeShapeName(shape)} edge${rigid ? " is rigid" : ""}`;
    const input = document.createElement("input");
    input.id = `edgeCurve${index}`;
    input.type = "range";
    input.min = "-1";
    input.max = "1";
    input.step = "0.01";
    input.value = String(state.edgeCurves[index] ?? 0);
    input.disabled = rigid;
    input.addEventListener("input", () => {
      state.edgeCurves[index] = Number(input.value);
      geometryDirty = true;
      updateDynamicOutputs();
      scheduleFrame();
    });
    label.append(input);
    edgeControls.append(label);
  });
  updateDynamicOutputs();
}

function renderDrumMap() {
  const map = $("drumMap");
  map.replaceChildren(...drumVoices.map((voice, index) => {
    const pad = document.createElement("button");
    pad.className = "tiles-drum-pad";
    pad.type = "button";
    pad.dataset.voiceIndex = String(index);
    pad.textContent = voice.name;
    pad.style.setProperty("--voice-color", voice.color);
    pad.addEventListener("click", () => {
      activeDrumIndex = index;
      if (state.audio) drumAudio.trigger(voice).catch(showError);
      emitPreview({
        kind: "note",
        source: "Tiles drum pad",
        sourceId: "tiles-drum-pad",
        voiceId: `tiles:pad:${voice.id}`,
        channel: 10,
        note: 36 + index,
        velocity: Math.max(1, Math.round(clamp(voice.level, 0, 1) * 127)),
        durationMs: Math.max(1, Math.round((voice.attack + voice.decay) * 1000)),
      });
      renderDrumPads();
    });
    return pad;
  }));
  renderDrumPads();
}

function renderDrumPads() {
  for (const pad of $("drumMap").querySelectorAll(".tiles-drum-pad")) {
    pad.classList.toggle("is-active", Number(pad.dataset.voiceIndex) === activeDrumIndex);
  }
}

function updateDynamicOutputs() {
  $("levelOut").textContent = pct(state.level);
  $("positionOut").textContent = `${(state.position * 100).toFixed(1)}%`;
  $("speedOut").textContent = `${state.speed.toFixed(2)} cyc/s`;
  $("densityOut").textContent = pct(state.density);
  $("lineAngleOut").textContent = `${Math.round(state.lineAngle)} deg`;
  $("patternAngleOut").textContent = `${Math.round(state.patternAngle)} deg`;
  $("readerTurnsOut").textContent = state.readerTurns.toFixed(1);
  $("spiralAOut").textContent = String(Math.round(state.spiralA));
  $("spiralBOut").textContent = String(Math.round(state.spiralB));
  $("loopPhaseOut").textContent = pct(state.loopPhase);
  $("baseFrequencyOut").textContent = `${Math.round(state.baseFrequency)} Hz`;
  $("pitchRangeOut").textContent = `${state.pitchRange.toFixed(1)} oct`;
  $("contactLevelOut").textContent = pct(state.contactLevel);
  $("stereoWidthOut").textContent = pct(state.stereoWidth);
  $("fmIndexOut").textContent = state.fmIndex.toFixed(1);
  $("pmIndexOut").textContent = state.pmIndex.toFixed(1);
  $("pitchDepthOut").textContent = `${Math.round(state.pitchDepth)} st`;
  $("characterDepthOut").textContent = pct(state.characterDepth);
  $("strikeLimitOut").textContent = String(Math.round(state.strikeLimit));
  const info = tilingInfo(state.tilingType);
  info.defaultParameters.forEach((_, index) => {
    const output = $(`tileParameter${index}Out`);
    if (output) output.textContent = Number(state.parameters[index] ?? 0).toFixed(3);
  });
  info.edgeShapes.forEach((shape, index) => {
    const output = $(`edgeCurve${index}Out`);
    if (output) output.textContent = edgeShapeName(shape) === "I" ? "rigid" : `${Math.round((state.edgeCurves[index] ?? 0) * 100)}%`;
  });
}

function renderControls() {
  renderModeSwitch();
  renderPitchSources();
  renderMappingSources();
  syncInput("level", state.level);
  syncInput("position", state.position);
  syncInput("speed", state.speed);
  syncInput("density", state.density);
  syncInput("lineAngle", state.lineAngle);
  syncInput("patternAngle", state.patternAngle);
  syncInput("readerTurns", state.readerTurns);
  syncInput("spiralA", state.spiralA);
  syncInput("spiralB", state.spiralB);
  syncInput("loopPhase", state.loopPhase);
  syncInput("baseFrequency", state.baseFrequency);
  syncInput("pitchRange", state.pitchRange);
  syncInput("contactLevel", state.contactLevel);
  syncInput("stereoWidth", state.stereoWidth);
  syncInput("fmIndex", state.fmIndex);
  syncInput("pmIndex", state.pmIndex);
  syncInput("pitchDepth", state.pitchDepth);
  syncInput("characterDepth", state.characterDepth);
  syncInput("strikeLimit", state.strikeLimit);
  syncCheckbox("sizeCoupling", state.sizeCoupling);
  $("timePath").value = state.timePath;
  $("soundMode").value = state.soundMode;
  $("audioButton").setAttribute("aria-pressed", String(state.audio));
  $("audioButton").dataset.audioState = state.audio ? "on" : "off";
  $("audioState").textContent = state.audio ? "on" : "off";
  setPressed($("playButton"), state.playing);
  $("playButton").setAttribute("aria-label", state.playing ? "Pause reader" : "Play reader");
  $("playButtonLabel").textContent = state.playing ? "Pause" : "Play";
  $("traversalDirection").dataset.direction = state.traversalDirection >= 0 ? "forward" : "reverse";
  $("traversalDirection").setAttribute("aria-label", `Reader direction: ${state.traversalDirection >= 0 ? "forward" : "reverse"}`);
  $("traversalDirectionText").textContent = state.traversalDirection >= 0 ? "forward" : "reverse";
  setPressed($("loopMotion"), state.motionMode === "loop");
  setPressed($("pingPongMotion"), state.motionMode === "ping-pong");
  updateDynamicOutputs();
  updateAudioLevel();
}

function drawPath(context, points, { close = false, fill = null, stroke = null, width = 1 } = {}) {
  if (!points?.length) return;
  context.beginPath();
  context.moveTo(points[0].x, points[0].y);
  for (let index = 1; index < points.length; index += 1) context.lineTo(points[index].x, points[index].y);
  if (close) context.closePath();
  if (fill) {
    context.fillStyle = fill;
    context.fill();
  }
  if (stroke) {
    context.strokeStyle = stroke;
    context.lineWidth = width;
    context.stroke();
  }
}

function fitWorld(context, canvas, bounds) {
  const width = canvas.width;
  const height = canvas.height;
  const worldWidth = bounds.maxX - bounds.minX;
  const worldHeight = bounds.maxY - bounds.minY;
  const scale = Math.min(width / worldWidth, height / worldHeight) * 0.92;
  context.translate(width / 2, height / 2);
  context.scale(scale, -scale);
  context.translate(-(bounds.minX + bounds.maxX) / 2, -(bounds.minY + bounds.maxY) / 2);
  return scale;
}

function drawLattice(context, canvas, scan, offset, contacts) {
  const scale = fitWorld(context, canvas, LATTICE_BOUNDS);
  context.translate(offset.x, offset.y);
  for (const tile of lattice.tiles) {
    drawPath(context, tile.points, {
      close: true,
      fill: TILE_COLORS[Math.abs(tile.color ?? tile.aspect ?? 0) % TILE_COLORS.length],
    });
  }
  for (const edge of lattice.edges) {
    drawPath(context, edge.points, {
      stroke: EDGE_COLORS[Math.abs(edge.edgeShapeId ?? edge.edgeIndex ?? 0) % EDGE_COLORS.length],
      width: 1.2 / scale,
    });
  }
  context.translate(-offset.x, -offset.y);
  const lineStart = {
    x: scan.origin.x - scan.tangent.x * scan.tangentSupport * 1.25,
    y: scan.origin.y - scan.tangent.y * scan.tangentSupport * 1.25,
  };
  const lineEnd = {
    x: scan.origin.x + scan.tangent.x * scan.tangentSupport * 1.25,
    y: scan.origin.y + scan.tangent.y * scan.tangentSupport * 1.25,
  };
  drawPath(context, [lineStart, lineEnd], { stroke: "rgba(255, 255, 255, .86)", width: 1.8 / scale });
  drawContacts(context, contacts, scale);
}

function drawSpiral(context, canvas, reader, contacts) {
  const bounds = { minX: -1.18, minY: -1.18, maxX: 1.18, maxY: 1.18 };
  const scale = fitWorld(context, canvas, bounds);
  for (const tile of tessellation.tiles) {
    drawPath(context, tile.points, {
      close: true,
      fill: TILE_COLORS[Math.abs(tile.color ?? tile.aspect ?? 0) % TILE_COLORS.length],
    });
  }
  for (const edge of tessellation.edges) {
    drawPath(context, edge.points, {
      stroke: EDGE_COLORS[Math.abs(edge.edgeShapeId ?? edge.edgeIndex ?? 0) % EDGE_COLORS.length],
      width: 1.05 / scale,
    });
  }
  drawPath(context, reader.points, { stroke: "rgba(255, 255, 255, .86)", width: 1.8 / scale });
  drawContacts(context, contacts, scale);
}

function drawContacts(context, contacts, scale) {
  context.save();
  context.fillStyle = "rgba(255, 255, 255, .92)";
  context.strokeStyle = "rgba(0, 0, 0, .38)";
  context.lineWidth = 1 / scale;
  for (const contact of contacts.slice(0, 180)) {
    const radius = (isDrumMode() ? 4.3 : 3.4) / scale * (0.75 + 0.55 * clamp(contact.incidence, 0, 1));
    context.beginPath();
    context.arc(contact.x, contact.y, radius, 0, TAU);
    context.fill();
    context.stroke();
  }
  context.restore();
}

function resizeCanvas(canvas) {
  const rect = canvas.getBoundingClientRect();
  const ratio = Math.max(1, Math.min(2, window.devicePixelRatio || 1));
  const width = Math.max(1, Math.round(rect.width * ratio));
  const height = Math.max(1, Math.round(rect.height * ratio));
  if (canvas.width !== width || canvas.height !== height) {
    canvas.width = width;
    canvas.height = height;
  }
}

function renderStage(contacts, readerData) {
  const canvas = $("stage");
  resizeCanvas(canvas);
  const context = canvas.getContext("2d");
  context.clearRect(0, 0, canvas.width, canvas.height);
  context.save();
  if (isSpiralMode()) drawSpiral(context, canvas, readerData.reader, contacts);
  else drawLattice(context, canvas, readerData.scan, readerData.offset, contacts);
  context.restore();
}

function updateReadouts(contacts) {
  const mode = modeInfo();
  const contactText = `${contacts.length} ${contacts.length === 1 ? "CONTACT" : "CONTACTS"}`;
  const transport = state.playing ? "PLAYING" : "PAUSED";
  const audio = state.audio ? "AUDIO ON" : "AUDIO OFF";
  $("stageReadout").textContent = `${mode.label.toUpperCase()} - ${contactText} - ${transport} - ${audio}`;
  $("mappingReadout").textContent = isDrumMode()
    ? `DRUMS - ${currentMappingMode().replaceAll("-", " ").toUpperCase()}`
    : `SYNTH - ${activePitchSource().replaceAll("-", " ").toUpperCase()}`;
}

function frame(now) {
  scheduledFrame = 0;
  const delta = Math.min(0.1, Math.max(0, (now - lastFrameTime) / 1000));
  lastFrameTime = now;
  if (state.playing) {
    state.continuousPosition += state.traversalDirection * state.speed * delta;
    state.position = state.motionMode === "ping-pong"
      ? pingPong01(state.continuousPosition)
      : wrap01(state.continuousPosition);
    syncInput("position", state.position);
    updateDynamicOutputs();
  }
  if (geometryDirty || !lattice || !tessellation) rebuildGeometry();
  const readerData = isSpiralMode() ? spiralContactsForState() : latticeContactsForState();
  const contacts = readerData.contacts;
  updateContactAges(contacts, delta);
  renderStage(contacts, readerData);
  if (isDrumMode()) {
    synthPool.silence();
    triggerDrums(contacts, now);
    previewDrumOnsets(contacts, now);
  } else {
    const voices = currentSynthVoices(contacts);
    if (state.audio) synthPool.setVoices(voices, { requestedVoiceCount: contacts.length, mode: state.soundMode });
    previewSynthOnsets(contacts, voices, now);
  }
  previousContactKeys = currentContactKeys(contacts);
  midiPreviewContactKeys = currentContactKeys(contacts);
  renderDrumPads();
  updateReadouts(contacts);
  if (state.playing) scheduleFrame();
}

function pointerToWorld(event) {
  const canvas = $("stage");
  const rect = canvas.getBoundingClientRect();
  const x = ((event.clientX - rect.left) / Math.max(1, rect.width)) * 2 - 1;
  const y = 1 - ((event.clientY - rect.top) / Math.max(1, rect.height)) * 2;
  if (isSpiralMode()) return { x: x * SPIRAL_BOUNDS.outerRadius * 1.08, y: y * SPIRAL_BOUNDS.outerRadius * 1.08 };
  const width = LATTICE_BOUNDS.maxX - LATTICE_BOUNDS.minX;
  const height = LATTICE_BOUNDS.maxY - LATTICE_BOUNDS.minY;
  return {
    x: (LATTICE_BOUNDS.minX + LATTICE_BOUNDS.maxX) / 2 + x * width * 0.5,
    y: (LATTICE_BOUNDS.minY + LATTICE_BOUNDS.maxY) / 2 + y * height * 0.5,
  };
}

function setPositionFromPointer(event) {
  const point = pointerToWorld(event);
  if (isSpiralMode()) {
    state.position = phaseForSpiralPoint(point, {
      mode: state.timePath,
      ...SPIRAL_BOUNDS,
      turns: state.readerTurns,
      sizeCoupled: state.sizeCoupling,
    });
  } else {
    const scan = createScanLine(LATTICE_BOUNDS, 0.5, state.lineAngle);
    const distance = (point.x - scan.center.x) * scan.normal.x
      + (point.y - scan.center.y) * scan.normal.y;
    state.position = clamp(distance / Math.max(1e-9, scan.support) * 0.5 + 0.5, 0, 1);
  }
  state.continuousPosition = state.position;
  previousContactKeys = new Set();
  midiPreviewContactKeys = new Set();
  syncInput("position", state.position);
  updateDynamicOutputs();
  scheduleFrame();
}

function bindRange(id, key, { geometry = false, integer = false } = {}) {
  const input = $(id);
  input.addEventListener("input", () => {
    state[key] = integer ? Math.round(Number(input.value)) : Number(input.value);
    if (key === "position") state.continuousPosition = state.position;
    if (geometry) geometryDirty = true;
    clearError();
    updateDynamicOutputs();
    updateAudioLevel();
    scheduleFrame();
  });
}

function bindControls() {
  for (const { id } of TILES_APP_MODES) {
    const button = $("tilesMode").querySelector(`[data-tiles-mode="${id}"]`);
    button?.addEventListener("click", () => setMode(id));
  }
  $("audioButton").addEventListener("click", () => setAudioEnabled(!state.audio));
  $("playButton").addEventListener("click", () => {
    state.playing = !state.playing;
    if (!state.playing) synthPool.silence();
    emitPreview({
      kind: "transport",
      source: "Tiles transport",
      sourceId: "tiles-transport",
      state: state.playing ? "start" : "stop",
      position: state.position,
    });
    renderControls();
    scheduleFrame();
  });
  $("traversalDirection").addEventListener("click", () => {
    state.traversalDirection *= -1;
    renderControls();
    scheduleFrame();
  });
  $("loopMotion").addEventListener("click", () => {
    state.motionMode = "loop";
    state.continuousPosition = state.position;
    renderControls();
  });
  $("pingPongMotion").addEventListener("click", () => {
    state.motionMode = "ping-pong";
    state.continuousPosition = state.position;
    renderControls();
  });
  bindRange("level", "level");
  bindRange("position", "position");
  bindRange("speed", "speed");
  bindRange("density", "density", { geometry: true });
  bindRange("lineAngle", "lineAngle", { geometry: true });
  bindRange("patternAngle", "patternAngle", { geometry: true });
  bindRange("readerTurns", "readerTurns");
  bindRange("spiralA", "spiralA", { geometry: true, integer: true });
  bindRange("spiralB", "spiralB", { geometry: true, integer: true });
  bindRange("loopPhase", "loopPhase", { geometry: true });
  bindRange("baseFrequency", "baseFrequency");
  bindRange("pitchRange", "pitchRange");
  bindRange("contactLevel", "contactLevel");
  bindRange("stereoWidth", "stereoWidth");
  bindRange("fmIndex", "fmIndex");
  bindRange("pmIndex", "pmIndex");
  bindRange("pitchDepth", "pitchDepth", { integer: true });
  bindRange("characterDepth", "characterDepth");
  bindRange("strikeLimit", "strikeLimit", { integer: true });
  $("timePath").addEventListener("change", () => {
    state.timePath = $("timePath").value;
    previousContactKeys = new Set();
    midiPreviewContactKeys = new Set();
    scheduleFrame();
  });
  $("soundMode").addEventListener("change", () => {
    state.soundMode = $("soundMode").value;
    scheduleFrame();
  });
  $("pitchSource").addEventListener("change", () => {
    state.pitchSourceByGeometry[modeInfo().geometryKind] = $("pitchSource").value;
    scheduleFrame();
  });
  $("mappingMode").addEventListener("change", () => {
    setCurrentMappingMode($("mappingMode").value);
    previousContactKeys = new Set();
    midiPreviewContactKeys = new Set();
    scheduleFrame();
  });
  $("sizeCoupling").addEventListener("change", () => {
    state.sizeCoupling = $("sizeCoupling").checked;
    scheduleFrame();
  });
  $("tilingType").addEventListener("change", () => {
    const info = tilingInfo(Number($("tilingType").value));
    state.tilingType = info.type;
    state.parameters = [...info.defaultParameters];
    state.edgeCurves = Array.from({ length: info.edgeShapes.length }, () => 0);
    geometryDirty = true;
    previousContactKeys = new Set();
    midiPreviewContactKeys = new Set();
    renderTileControls();
    scheduleFrame();
  });
  $("resetTile").addEventListener("click", () => {
    const info = tilingInfo(state.tilingType);
    state.parameters = [...info.defaultParameters];
    state.edgeCurves = Array.from({ length: info.edgeShapes.length }, () => 0);
    geometryDirty = true;
    renderTileControls();
    scheduleFrame();
  });
  $("straightenEdges").addEventListener("click", () => {
    state.edgeCurves = state.edgeCurves.map(() => 0);
    geometryDirty = true;
    renderTileControls();
    scheduleFrame();
  });
  $("stage").addEventListener("pointerdown", (event) => {
    pointer.active = true;
    $("stage").setPointerCapture?.(event.pointerId);
    setPositionFromPointer(event);
  });
  $("stage").addEventListener("pointermove", (event) => {
    if (pointer.active) setPositionFromPointer(event);
  });
  $("stage").addEventListener("pointerup", (event) => {
    pointer.active = false;
    $("stage").releasePointerCapture?.(event.pointerId);
  });
  window.addEventListener("resize", scheduleFrame);
}

function initializeSelectors() {
  const tilingSelect = $("tilingType");
  tilingSelect.replaceChildren(...TILING_TYPES.map((info) => {
    const option = document.createElement("option");
    option.value = String(info.type);
    option.textContent = info.label;
    return option;
  }));
  tilingSelect.value = String(state.tilingType);
}

function initialize() {
  initializeSelectors();
  renderTileControls();
  renderDrumMap();
  bindControls();
  renderControls();
  scheduleFrame();
}

initialize();

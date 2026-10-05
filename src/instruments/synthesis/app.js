import { SYNTHESIS_DATES } from "./chronology.js";
import { SEQUENCE_STUDIES, SEQUENCE_STUDY_COUNT } from "./sequence-catalog.js";
import { compileSequence } from "./sequence-compiler.js";
import { sequenceRegisterMultiplier } from "./sequence-register.js";
import { createSequenceSurface } from "./sequence-surfaces.js";
import { createSequenceMechanismView } from "./sequence-mechanism-view.js";
import { createSequenceParameterValues, getSequenceParameterBounds, getSequenceParameterDefinitions } from "./sequence-parameters.js";
import { createChaoticSpectrum, updateChaoticSpectrum, drawChaoticSpectrum } from "../../families/chaotic/chaotic-synth-visuals.js";
import { registerHeaderPresets } from "../../site/header-presets.js";
import { SECTION_METHODS, methodSection, captureSoundState, randomizeMethodState } from "./presets.js";
import { instrumentPresetsForInput, captureInstrumentPreset, randomizeInstrumentPreset, fitRandomAttackToSequence } from "./instrument-presets.js";
import {
  SEQUENCE_SETTING_RECIPES,
  applySequenceSettingsRecipe,
  createSequenceSettingsPresets,
  nextTuningId,
  randomizeSequenceSettings,
} from "./performance-presets.js";
import { PROCESSING_SCHEMA } from "./processing-schema.js";
import { createProcessorPanel } from "./processor-panel.js";
import { getAmplitudeModel } from "./amplitude-models.js";
import { inputCategoryFor, inputsForCategory, presetSignal, sanitizeSignalPath } from "./signal-path.js";
import { PROCESSING_INPUT_OPTIONS, getProcessingInput } from "./demo-sources.js";
import { enhanceChooseSelect } from "./choose.js";
import { COMPUTER_KEYBOARD_LAYOUTS } from "../../midi-manager.js";
import { getMethod, getPreset, createDefaultState, stateFromPreset, sanitizeState } from "./catalog.js";
import { SynthesisAudio } from "./audio.js";
import { isVoiceInput } from "./voice-input-state.js";
import { mountVoiceInputPanel } from "./voice-input-panel.js";
import { VoiceInputSource } from "./voice-source.js";
import { mountPercussionPanel, DRUM_KEYS, DRUM_MIDI_NOTES } from "./percussion-panel.js";
import { compilePercussionSequence } from "./percussion-state.js";
import { mountAudioInputControl } from "../../audio-input-control.js";
import { createEnvelopeEditor } from "./envelope.js";
import { envelopeGateSeconds } from './envelope-shape.js';
import {
  ENVELOPE_PRESETS,
  getEnvelopePreset,
  matchEnvelopePreset,
  nextEnvelopePreset,
  randomizeEnvelope,
} from "./envelope-presets.js";
import { createParameterControl, createKnobControl } from "./controls.js";
import { createMethodGestureEditor, groupMethodControls, METHOD_EDITOR_SCHEMAS } from "./method-ui.js";
import { TUNINGS, getTuning, sanitizeTuningId, tuningRatioForDegree,
  tuningRatioForSemitoneCoordinate, frequencyForTuningDegree, frequencyForMidiNote,
  arpeggioDegrees } from "./tunings.js";

const $ = id => document.getElementById(id);
const listeners = new AbortController();
const listen = (target, name, handler, options = {}) => target.addEventListener(name, handler, { ...options, signal: listeners.signal });
const query = new URLSearchParams(location.search);
let state = createDefaultState(query.get("method") || "additive");
if (query.has("preset")) state = stateFromPreset(state.methodId, query.get("preset"), state);
if (query.has("tuning")) state = sanitizeState({ ...state, tuningId: sanitizeTuningId(query.get("tuning")) });
const BASIC_SEQUENCES = Object.freeze([
  Object.freeze({ id: "basic-up", label: "Tuning chord · up", mode: "up" }),
  Object.freeze({ id: "basic-down", label: "Tuning chord · down", mode: "down" }),
  Object.freeze({ id: "basic-up-down", label: "Tuning chord · up–down", mode: "up-down" }),
]);
const basicSequence = id => BASIC_SEQUENCES.find(item => item.id === id) || null;
const requestedSequence = SEQUENCE_STUDIES.find(study => study.id === query.get("sequence")) || null;
const requestedBasicSequence = basicSequence(query.get("sequence"));
const queryNumber = (name, fallback) => {
  const raw = query.get(name);
  if (raw === null || raw.trim() === "") return fallback;
  const value = Number(raw);
  return Number.isFinite(value) ? value : fallback;
};
const queryObject = name => {
  const raw = query.get(name);
  if (!raw || raw.length > 16384) return {};
  try {
    const value = JSON.parse(raw);
    return value && typeof value === "object" && !Array.isArray(value) ? value : {};
  } catch { return {}; }
};
const requestedSequenceTempo = queryNumber(
  "sequenceTempo",
  requestedSequence?.defaults.tempoBpm ?? 120,
);
const requestedParameterQuery = queryObject("sequenceParams");
const requestedParameters = requestedSequence ? createSequenceParameterValues(requestedSequence, {
  ...requestedParameterQuery,
  density: queryNumber("sequenceDensity", requestedParameterQuery.density ?? requestedSequence.defaults.density),
  swing: queryNumber("sequenceSwing", requestedParameterQuery.swing ?? 0),
  seed: queryNumber("sequenceSeed", requestedParameterQuery.seed ?? requestedSequence.defaults.seed),
  pitchMode: query.get("sequencePitch") || requestedParameterQuery.pitchMode,
}) : null;
let sequenceState = {
  id: requestedSequence?.id || requestedBasicSequence?.id || "none",
  density: requestedParameters?.density ?? 1,
  swing: requestedParameters?.swing ?? 0,
  seed: requestedParameters?.seed ?? 1,
  cycle: null,
  cursor: null,
  workletStatus: null,
  pitchMode: requestedParameters?.pitchMode || "nearest",
  parameters: requestedParameters,
};
const sequenceParameterSessions = new Map(requestedSequence ? [[requestedSequence.id, requestedParameters]] : []);
let playing = false;
let arming = false;
let configurationQueued = false;
let auditionQueued = false;
let deferTransportSync = false;
let deferAudioSync = false;
let fullPresets = null;
let voiceRenderTimer = null;
let lastFactoryPreset = { methodId: state.methodId, presetId: state.presetId };
let activeSection = methodSection(state.methodId);
const sectionSessions = Object.fromEntries(Object.entries(SECTION_METHODS).map(([section, methods]) => {
  const initial = section === activeSection ? state : createDefaultState(methods[0].id);
  return [section, {
    sound: captureSoundState(initial),
    lastFactoryPreset: { methodId: initial.methodId, presetId: initial.presetId },
    hasPresetInteraction: false,
  }];
}));
let frames = 0;
let lastDraw = 0;
let lastPeak = 0.05;
let controlFields = [];
let methodGestureEditor = null;
let synthesisSourceName = "Built-in synthetic source";
let inputCategory = activeSection === "processing" ? "signals" : "synthesis";
let processingInput = activeSection === "processing" ? presetSignal(state.source) : "noise";
let effectState = activeSection === "processing" ? sanitizeState(state) : createDefaultState("fx-reverb");
let effectEnabled = activeSection === "processing";
let processorPanel = null;
const inputSelections = { samples: "sample-drums", signals: processingInput };
let inputIntent = 0;
let pendingHostDrums = [];
let loadingInput = false;
let inputControl = null;
let inputGainField = null;
let inputError = "";
const chooseControls = new Map();
const held = new Map();
let noteSequence = 0;
const keyButtons = new Map();
const offsets = COMPUTER_KEYBOARD_LAYOUTS.piano.noteOffsets;
const wave = new Float32Array(4096);
const frequencies = new Float32Array(2048).fill(-Infinity);
const displayWave = new Float32Array(4096);
const inputWave = new Float32Array(2048);
const barSpectrum = createChaoticSpectrum();
barSpectrum.frequencyData = frequencies;
barSpectrum.displayData = new Float32Array(2048).fill(-100);
barSpectrum.minimumDecibels = -100;
let displayFrequency = state.frequencyHz;
let analysisDirty = true;
const audio = new SynthesisAudio(error => {
  pendingHostDrums = [];
  clearTimeout(voiceRenderTimer);
  voiceSource.deactivate();
  showError(error);
  paintAudio();
}, paintInput);
audio.setSequenceStatusListener(status => { sequenceState.workletStatus = status; });
const voiceSource = new VoiceInputSource({
  host: () => ({ armed: audio.armed && isVoiceInput(inputCategory), context: audio.context, input: audio.input }),
  renderSampleBank: (request, options) => voicePanel.renderSampleBank(request, options),
  error: showError,
  changed: status => {
    $("voiceInputStatus").textContent = status.loading ? "Rendering voice…" : !audio.armed ? "Enable Audio to hear this voice."
      : status.renderError || status.timingWarning ? status.renderError || status.timingWarning
      : status.playing ? "" : status.duration ? "Ready" : "Press Play to hear this voice.";
  },
  activity: active => { if (isVoiceInput(inputCategory)) audio.setPlaying(playing || active); },
  ended: () => { if (isVoiceInput(inputCategory) && playing && !voiceSource.busy) setPlaying(false); },
});
const voicePanel = mountVoiceInputPanel($("voiceInputPanel"), {
  change: () => {
    clearTimeout(voiceRenderTimer); voiceSource.invalidate();
    fullPresets?.refresh(); paintSignalPath();
    if (playing) voiceRenderTimer = setTimeout(() => { void ensureProcessingInput({ force: true }); }, 160);
  },
  error: showError,
  audition: request => {
    if (!audio.armed) { $("status").textContent = "Enable Audio to hear this voice."; return; }
    setPlaying(false); clearTimeout(voiceRenderTimer); void voiceSource.audition(request);
  },
  seek: async beat => {
    if (!audio.armed) return;
    // Seeking owns this render now; the edit debounce must not cancel it later.
    clearTimeout(voiceRenderTimer);
    const intent = inputIntent, revision = voicePanel.revision;
    const ready = await ensureProcessingInput();
    if (!ready || intent !== inputIntent || revision !== voicePanel.revision || !isVoiceInput(inputCategory)) return;
    if (voiceSource.seekBeat(beat)) setPlaying(true);
  },
});

const drumPanel = mountPercussionPanel($("drumInputPanel"), {
  change: (_next, { rhythm = false } = {}) => {
    if (rhythm) syncDrumSequence();
    else syncAudio();
    fullPresets?.refresh(); paintSignalPath();
  },
  hit: (lane, velocity) => {
    if (!audio.armed) { $("status").textContent = "Enable Audio to hear the drum pads."; return; }
    audio.drumHit(lane, velocity);
  },
});

function showError(error) {
  $("audioError").hidden = false;
  $("audioError").textContent = error?.message || String(error);
  $("status").textContent = $("audioError").textContent;
}

function configuredAudioState() {
  const method = getMethod(state.methodId);
  return {
    ...state,
    ...((isVoiceInput(inputCategory) || inputCategory === 'percussion') && !effectEnabled ? { bypass: true, inputDb: 0, outputDb: 0 } : {}),
    percussion: inputCategory === 'percussion' ? { voices: drumPanel.getState().voices } : null,
    source: method.kind === "processor" ? processingSource() : state.source,
    kind: method.kind || "synthesis",
    engineId: method.engineId,
    processorId: method.processorId,
    insert: method.kind !== "processor" && effectEnabled ? {
      ...effectState, processorId: getMethod(effectState.methodId).processorId, source: 0,
    } : null,
    playStyle: basePlaybackStyle(),
  };
}

function syncAudio(audition = false) {
  auditionQueued ||= audition;
  if (configurationQueued) return;
  configurationQueued = true;
  queueMicrotask(() => {
    configurationQueued = false;
    const atomicPresetRecall = auditionQueued && playing && sequenceOwnsTransport();
    const audition = auditionQueued && !atomicPresetRecall;
    auditionQueued = false;
    if (atomicPresetRecall) {
      const nextAudioState = configuredAudioState();
      const methodChanged = audio.state?.kind !== nextAudioState.kind
        || audio.state?.engineId !== nextAudioState.engineId;
      // A preset within one method keeps the phrase and current gate. Changing
      // engines launches the first authored attack so struck Poly models cannot
      // wait silently for the next score event.
      rebuildSequence({ restart: methodChanged, route: false, audioState: nextAudioState });
    } else audio.configure(configuredAudioState(), { audition });
  });
}

function paintAudio() {
  $("audioButton").setAttribute("aria-pressed", String(audio.armed));
  $("audioButton").setAttribute("aria-label", arming ? "Audio is starting" : audio.armed ? "Audio is on. Mute audio" : "Audio is off. Enable audio");
  $("audioButton").classList.toggle("is-on", audio.armed);
  $("audioState").textContent = arming ? "starting" : audio.armed ? "on" : "off";
  $("signalStatus").textContent = arming ? "Starting…" : audio.armed ? "Ready" : "Audio off";
  paintInput();
  paintProcessorLatency();
  $("status").textContent = audio.armed ? "Audio enabled. Play or audition the demonstration." : "Audio is off.";
}

listen($("audioButton"), "click", async () => {
  if (arming) return;
  $("audioError").hidden = true;
  if (audio.armed) { inputIntent++; loadingInput = false; clearTimeout(voiceRenderTimer); voiceSource.deactivate(); audio.mute(); paintAudio(); return; }
  arming = true;
  paintAudio();
  try {
    syncAudio(); await audio.start();
    audio.resumeNotes(Array.from(held.values()));
    const drumHits = pendingHostDrums; pendingHostDrums = [];
    if (inputCategory === 'percussion') for (const hit of drumHits) {
      if (hit.intent === inputIntent) audio.drumHit(hit.lane, hit.velocity);
    }
    void ensureProcessingInput();
  }
  catch (error) { pendingHostDrums = []; audio.mute(); showError(error); }
  finally { arming = false; paintAudio(); }
});

function rememberSection() {
  const session = sectionSessions[activeSection];
  session.sound = captureSoundState(state);
  session.lastFactoryPreset = { ...lastFactoryPreset };
  if (fullPresets) session.hasPresetInteraction = fullPresets.hasPresetInteraction;
}

function syncPresetToolbar() {
  const method = getMethod(state.methodId);
  const select = $("presetSelect");
  select.replaceChildren(...(state.presetId === "custom" ? [new Option("Custom settings", "custom")] : []),
    ...method.presets.map(preset => new Option(`${preset.name} · ${method.label}`, preset.id)));
  select.value = state.presetId;
  chooseControls.get("presetSelect")?.refresh();
  fullPresets?.refresh();
  rememberSection();
}

function markCustom() {
  state.presetId = "custom";
  syncPresetToolbar();
  $("presetCue").textContent = "Custom settings. Next continues the preset tour.";
  paintPlayback();
  syncAudio();
}

function setFrequency(value) {
  if (!Number.isFinite(value)) return;
  state.frequencyHz = Math.min(8000, Math.max(20, value));
  if (activeSection === "processing") effectState.frequencyHz = state.frequencyHz;
  frequencyField.setValue(state.frequencyHz);
  if (hasSequence() && !retuneSequenceRoot()) rebuildSequence();
  paintVoicing();
  markCustom();
}
const frequencyField = createKnobControl({
  id: "frequency", editorId: "frequencyHz", label: "Frequency", min: 20, max: 8000,
  scale: "log", unit: "Hz", value: state.frequencyHz,
  formatValue: value => Number(value.toFixed(1)) + " Hz", onInput: setFrequency,
});
$("frequencyControl").append(frequencyField);
const tempoField = createKnobControl({ id: "tempo", label: "Tempo", min: 10, max: 1200, step: 1,
  value: requestedSequenceTempo, unit: "BPM", onInput: updateTempo });
const gateField = createKnobControl({ id: "noteGate", label: "Note length", min: 5, max: 95, step: 1,
  value: 65, unit: "%", onInput: updateGate });
$("tempoControl").append(tempoField); $("gateControl").append(gateField);
let sequenceParameterFields = [];
let sequenceSurface = null;
const mixFields = {};
for (const [id, host, key, label, min, max, factor, unit] of [
  ["dryWet", "wetControl", "wet", "Wet", 0, 100, .01, "%"],
  ["inputGain", "inputGainControl", "inputDb", "Input gain", -36, 24, 1, "dB"],
  ["effectGain", "effectGainControl", "outputDb", "Effect output", -36, 24, 1, "dB"],
]) {
  const field = createKnobControl({ id, label, min, max, step: factor === .01 ? 1 : .5, unit,
    value: (effectState[key] ?? (key === "wet" ? 1 : 0)) / factor,
    onInput: value => { effectState[key] = value * factor; effectState.presetId = "custom"; updateEffect(); } });
  $(host).append(field); mixFields[key] = field;
}

processorPanel = createProcessorPanel($("processorPanel"), effectState, (next, options) => { effectState = next; updateEffect(options); });
function updateEffect({ audition = false } = {}) {
  if (activeSection === "processing") state = sanitizeState({ ...effectState, outputLevel: state.outputLevel, voiceMode: state.voiceMode, tuningId: state.tuningId });
  sectionSessions.processing.sound = captureSoundState(effectState);
  paintEffect(); syncAudio(audition && activeSection === "processing"); fullPresets?.refresh();
}
function paintEffect() {
  $("processorDetail").hidden = !effectEnabled;
  $("processorEnabled").checked = effectEnabled;
  $("processorEnabled").disabled = inputCategory !== "synthesis" && inputCategory !== 'percussion' && !isVoiceInput(inputCategory);
  processorPanel?.setValue(effectState);
  mixFields.wet.setValue(effectState.wet * 100);
  mixFields.inputDb.setValue(effectState.inputDb);
  mixFields.outputDb.setValue(effectState.outputDb);
  $("processingBypass").checked = effectState.bypass;
  const effect = getMethod(effectState.methodId);
  $("processorInfoTitle").textContent = effect.label;
  $("processorPrinciple").textContent = effect.principle;
  paintProcessorLatency();
  $("processorCue").textContent = effectState.presetId === "custom" ? "Custom settings." : getPreset(effect.id, effectState.presetId).cue;
  $("processorReference").href = `synthesaurus-reference.html#method-${effect.id}`;
  paintSignalPath();
}
function paintProcessorLatency() {
  const frames = getMethod(effectState.methodId).latencyFrames;
  const rate = audio.context?.sampleRate || 48000;
  const latency = $("processorLatency");
  latency.hidden = !frames;
  latency.textContent = frames ? `Latency: ${frames} samples · ${(frames / rate * 1000).toFixed(1)} ms at ${(rate / 1000).toFixed(1)} kHz. Dry/wet aligned; full bypass is immediate.` : "";
}
function paintSignalPath() {
  const source = inputCategory === "synthesis" ? getMethod(state.methodId).label
    : inputCategory === 'percussion' ? 'Drum sequencer + pads → Percussion'
    : inputCategory === "speech" ? "Speech synthesis" : inputCategory === "singing" ? "Singing synthesis"
    : inputCategory === "microphone" ? "Mic / audio in" : inputCategory === "file" ? "Audio file" : selectedInput()?.label ?? "Input";
  const notes = inputCategory === "synthesis" && hasSequence() ? "Arpeggiator + tuning → " : "";
  $("signalPathSummary").textContent = notes + source + (effectEnabled ? " → " + (effectState.bypass ? "Bypassed processor" : getMethod(effectState.methodId).label) : "") + " → Output";
}
function paintVoiceInput() {
  const voice = isVoiceInput(inputCategory);
  $("voiceDetail").hidden = !voice;
  $("drumDetail").hidden = inputCategory !== 'percussion';
  $("transportTiming").hidden = activeSection === 'processing' && inputCategory !== 'percussion';
  if (voice) voicePanel.setInput(inputCategory);
  else { clearTimeout(voiceRenderTimer); voiceSource.deactivate(); }
  if (fullPresets) mountInstrumentPresets();
}
listen($("processorEnabled"), "change", () => { effectEnabled = $("processorEnabled").checked; paintEffect(); syncAudio(); fullPresets?.refresh(); });

const envelopeEditor = createEnvelopeEditor($("envelopeControls"), {
  onChange(envelope) { state.envelope = envelope; markCustom(); paintEnvelopePreset(); },
});

function paintEnvelopePreset() {
  const matched = matchEnvelopePreset(state.envelope);
  const options = ENVELOPE_PRESETS.map(preset => new Option(preset.label, preset.id));
  if (!matched) options.unshift(new Option("Custom envelope", "custom"));
  $("envelopePresetSelect").replaceChildren(...options);
  $("envelopePresetSelect").value = matched?.id || "custom";
  chooseControls.get("envelopePresetSelect")?.refresh();
}

function applyEnvelopePreset(presetOrId) {
  const preset = getEnvelopePreset(presetOrId);
  state.envelope = { ...preset.envelope };
  envelopeEditor.setValue(state.envelope);
  markCustom();
  paintEnvelopePreset();
  syncAudio(true);
}

const sequenceStudy = () => SEQUENCE_STUDIES.find(study => study.id === sequenceState.id) || null;
const selectedBasicSequence = () => basicSequence(sequenceState.id);
const hasSequence = () => sequenceState.id !== "none" && (!!sequenceStudy() || !!selectedBasicSequence());
const sequenceOwnsTransport = () => inputCategory === 'percussion' || activeSection === "synthesis" && hasSequence();
const sequenceStepAt = step => Number(step?.at ?? step?.atBeats ?? 0);

function syncSequenceParameterState(values) {
  sequenceState.parameters = values;
  sequenceState.density = values?.density ?? 1;
  sequenceState.swing = values?.swing ?? 0;
  sequenceState.seed = values?.seed ?? 1;
  sequenceState.pitchMode = values?.pitchMode ?? "nearest";
  const study = sequenceStudy();
  if (study && values) sequenceParameterSessions.set(study.id, values);
}

function updateSequenceParameter(id, value) {
  const study = sequenceStudy();
  if (!study) return;
  syncSequenceParameterState(createSequenceParameterValues(study, {
    ...sequenceState.parameters,
    [id]: value,
  }));
  syncSequenceParameterFields(study);
  rebuildSequence();
}

function syncSequenceParameterFields(study = sequenceStudy()) {
  if (!study || !sequenceState.parameters) return;
  sequenceSurface?.setValue(sequenceState.parameters, sequenceState.cycle);
  for (const field of sequenceParameterFields) {
    const id = field.sequenceParameterId;
    if (id === "fullTraversal") field.setSequenceValue?.(Boolean(sequenceState.parameters.fullTraversal));
    if (id === "steps") field.hidden = Boolean(sequenceState.parameters.fullTraversal);
    if (!id || !Object.hasOwn(sequenceState.parameters, id)) continue;
    const bounds = getSequenceParameterBounds(study, id, sequenceState.parameters);
    if (bounds) {
      field.setSequenceBounds?.(bounds.min, bounds.max);
      field.setDisabled?.(bounds.min === bounds.max);
    }
    field.setSequenceValue?.(sequenceState.parameters[id]);
  }
}

function makeSequenceParameterField(definition, value) {
  const id = `sequence-param-${definition.id}`;
  if (definition.type === "select") {
    const root = document.createElement("div");
    root.className = "synthesis-parameter synthesis-parameter-choice";
    root.title = definition.help;
    const label = document.createElement("label"); label.htmlFor = id; label.textContent = definition.label;
    const select = document.createElement("select"); select.id = id;
    select.replaceChildren(...definition.choices.map(choice => new Option(choice.label, choice.value)));
    select.value = value;
    root.append(label, select);
    const picker = enhanceChooseSelect(select, { label: `Choose ${definition.label.toLowerCase()}` });
    const change = () => updateSequenceParameter(definition.id, select.value);
    select.addEventListener("change", change);
    root.sequenceParameterId = definition.id;
    root.setSequenceValue = next => { select.value = String(next); picker.refresh(); };
    root.destroy = () => { select.removeEventListener("change", change); picker.destroy(); root.remove(); };
    return root;
  }
  if (definition.type === "boolean") {
    const root = document.createElement("label");
    root.className = "synthesis-parameter synthesis-sequence-toggle";
    root.title = definition.help;
    const input = document.createElement("input"); input.type = "checkbox"; input.id = id; input.checked = value;
    const copy = document.createElement("span"); copy.textContent = definition.label;
    const change = () => updateSequenceParameter(definition.id, input.checked);
    input.addEventListener("change", change);
    root.append(input, copy);
    root.sequenceParameterId = definition.id;
    root.setSequenceValue = next => { input.checked = Boolean(next); };
    root.destroy = () => { input.removeEventListener("change", change); root.remove(); };
    return root;
  }
  if (definition.id === "seed") {
    const root = document.createElement("div");
    root.className = "synthesis-parameter synthesis-seed-control";
    root.title = definition.help;
    const label = document.createElement("label"); label.htmlFor = `${id}-value`; label.textContent = definition.label;
    const row = document.createElement("div"); row.className = "synthesis-seed-row";
    const input = document.createElement("input");
    input.type = "number"; input.id = `${id}-value`; input.min = String(definition.min);
    input.max = String(definition.max); input.step = String(definition.step); input.value = String(value);
    const reroll = document.createElement("button"); reroll.type = "button"; reroll.id = id;
    reroll.textContent = "New seed"; reroll.setAttribute("aria-label", "Generate a new sequence seed");
    const change = () => updateSequenceParameter(definition.id, input.valueAsNumber);
    const randomize = () => updateSequenceParameter(definition.id, Math.floor(Math.random() * (definition.max + 1)));
    input.addEventListener("change", change); reroll.addEventListener("click", randomize);
    row.append(input, reroll); root.append(label, row);
    root.sequenceParameterId = definition.id;
    root.setSequenceValue = next => { input.value = String(next); };
    root.destroy = () => { input.removeEventListener("change", change); reroll.removeEventListener("click", randomize); root.remove(); };
    return root;
  }
  const percent = definition.unit === "%" && definition.max <= 2;
  const factor = percent ? 100 : 1;
  const field = createKnobControl({
    id, label: definition.label,
    min: definition.min * factor, max: definition.max * factor,
    step: definition.step * factor, unit: definition.unit,
    help: definition.help,
    value: value * factor,
    onInput: next => updateSequenceParameter(definition.id, next / factor),
  });
  field.classList.add("synthesis-parameter");
  field.sequenceParameterId = definition.id;
  field.setSequenceValue = next => field.setValue(next * factor);
  field.setSequenceBounds = (min, max) => {
    field.setMinimum(min * factor);
    field.setMaximum(max * factor);
  };
  return field;
}

function paintSequenceParameterControls() {
  sequenceSurface?.destroy(); sequenceSurface = null;
  $("sequenceSurface").replaceChildren();
  sequenceParameterFields.forEach(field => field.destroy?.());
  sequenceParameterFields = [];
  const host = $("sequenceParameterControls");
  const study = sequenceStudy();
  $("gateControl").hidden = Boolean(study);
  if (!study) {
    const note = document.createElement("p");
    note.className = "synthesis-sequence-parameter-note";
    note.textContent = selectedBasicSequence()
      ? "This basic arpeggio follows the chord degrees in the selected tuning. Choose a historical study for editable mechanism controls."
      : "Choose an arpeggiator or sequence to reveal its cycle and mechanism controls.";
    host.replaceChildren(note);
    refreshSequencePresetSelection();
    return;
  }
  const values = createSequenceParameterValues(study, sequenceState.parameters);
  syncSequenceParameterState(values);
  sequenceSurface = createSequenceSurface($("sequenceSurface"), study, values, next => {
    syncSequenceParameterState(next); syncSequenceParameterFields(study); rebuildSequence();
  }) || createSequenceMechanismView($("sequenceSurface"), study, values, sequenceState.cycle);
  sequenceSurface?.setCursor(sequenceState.cursor);
  $("sequenceOutput").open = !sequenceSurface || Boolean(values.fullTraversal);
  const owned = new Set(sequenceSurface?.ownedParameterIds ?? []);
  const definitions = getSequenceParameterDefinitions(study).filter(definition => !owned.has(definition.id));
  const buildGrid = (items, className = "") => {
    const grid = document.createElement("div");
    grid.className = `synthesis-sequence-parameter-grid ${className}`.trim();
    for (const definition of items) {
      const field = makeSequenceParameterField(definition, values[definition.id]);
      sequenceParameterFields.push(field);
      grid.append(field);
    }
    return grid;
  };
  const mechanismName = study.archetype.split("-")
    .map(word => word[0].toUpperCase() + word.slice(1)).join(" ");
  const mechanismSection = document.createElement("section");
  mechanismSection.className = "synthesis-sequence-parameter-section";
  const heading = document.createElement("h3");
  heading.className = "synthesis-sequence-control-group";
  heading.textContent = `${mechanismName} controls`;
  const mechanism = definitions.filter(definition => definition.group === "mechanism");
  mechanismSection.append(heading, buildGrid(mechanism, "synthesis-sequence-parameter-grid--mechanism"));

  const cycleDetails = document.createElement("details");
  cycleDetails.className = "synthesis-sequence-cycle-details";
  cycleDetails.open = true;
  const summary = document.createElement("summary");
  summary.textContent = "Cycle, articulation & pitch mapping";
  const cycle = definitions.filter(definition => definition.group === "cycle");
  const cycleSection = (label, ids) => {
    const section = document.createElement("section");
    section.className = "synthesis-sequence-parameter-section synthesis-sequence-parameter-section--shared";
    const title = document.createElement("h3"); title.className = "synthesis-sequence-control-group"; title.textContent = label;
    section.append(title, buildGrid(cycle.filter(definition => ids.includes(definition.id)), "synthesis-sequence-parameter-grid--cycle"));
    return section;
  };
  cycleDetails.append(summary,
    cycleSection("Clock & cycle", ["steps", "stepBeats", "swing"]),
    cycleSection("Articulation & chance", ["gate", "density", "seed"]),
    cycleSection("Pitch output", ["transpose", "pitchMode"]));
  host.replaceChildren(mechanismSection, cycleDetails);
  syncSequenceParameterFields(study);
  refreshSequencePresetSelection();
}

function populateTuningSelect() {
  $("tuningSelect").replaceChildren(...TUNINGS.map(tuning => new Option(tuning.label, tuning.id)));
  $("tuningSelect").value = state.tuningId;
}

function paintTuning() {
  const tuning = getTuning(state.tuningId);
  $("tuningInfoTitle").textContent = tuning.label;
  $("tuningDescription").textContent = tuning.description;
  $("tuningCaveat").textContent = tuning.caveat || "This tuning determines the intervals; the arpeggiator determines their order and rhythm.";
  $("tuningInfoReference").href = `synthesaurus-reference.html#tuning-${tuning.id}`;
}

function populateSequenceSelect() {
  $("sequenceSelect").replaceChildren(new Option("Direct note", "none"),
    ...[...SEQUENCE_STUDIES].sort((a, b) => a.placementYear - b.placementYear || a.label.localeCompare(b.label))
      .map(study => new Option(`${study.label} · ${study.shortDateLabel}`, study.id)),
    ...BASIC_SEQUENCES.map(item => new Option(item.label, item.id)));
  $("sequenceSelect").value = sequenceState.id;
}

function populateSequencePresetSelect() {
  const study = sequenceStudy();
  const presets = study ? createSequenceSettingsPresets(study) : [];
  $("sequencePresetSelect").replaceChildren(
    new Option(study ? "Custom settings" : "Direct / tuning pattern", "custom"),
    ...presets.map(preset => new Option(preset.label, preset.id.split(":").at(-1))));
}

function refreshSequencePresetSelection() {
  const study = sequenceStudy();
  const disabled = !study || activeSection === "processing";
  $("sequencePresetSelect").disabled = disabled;
  $("nextSequencePreset").disabled = disabled;
  $("randomSequencePreset").disabled = disabled;
  populateSequencePresetSelect();
  if (study) {
    const parameters = JSON.stringify(sequenceState.parameters);
    const matching = createSequenceSettingsPresets(study).find(preset =>
      preset.snapshot.tempoBpm === Number($("tempo").value) && JSON.stringify(preset.snapshot.parameters) === parameters);
    $("sequencePresetSelect").value = matching?.id.split(":").at(-1) || "custom";
  }
  chooseControls.get("sequencePresetSelect")?.refresh();
  fullPresets?.refresh();
}

function paintSequenceMetadata() {
  const study = sequenceStudy(), basic = selectedBasicSequence();
  const active = !!study || !!basic;
  $("sequenceSelect").value = study?.id || basic?.id || "none";
  $("sequenceControls").hidden = !active;
  $("sequenceStrip").hidden = !active;
  $("sequenceOutput").hidden = !active;
  if (!study) $("sequenceOutput").open = active;
  $("sequenceShapeSummary").hidden = !active;
  $("sequenceInfoTitle").textContent = study?.label || basic?.label || "Direct note";
  $("sequenceCue").textContent = study?.cue || (basic
    ? `Traverses the chord degrees in ${getTuning(state.tuningId).label}.`
    : "Play holds or repeats the current sound without an additional pitch sequence.");
  $("sequenceInfoDetails").textContent = study
    ? [study.lineage, study.limitations, "Notes are separately triggered; there is no adjustable arpeggiator portamento."].filter(Boolean).join(" ")
    : "Choose a historical method for editable cycle, articulation and pitch controls.";
  $("sequenceInfoReference").href = study
    ? `synthesaurus-reference.html#sequence-${study.id}` : "synthesaurus-reference.html#arpeggiators";
  chooseControls.get("sequenceSelect")?.refresh();
}

function paintSequenceStrip() {
  const strip = $("sequenceStrip");
  const cycle = sequenceState.cycle;
  if (!cycle) {
    strip.replaceChildren();
    strip.setAttribute("aria-label", "No sequence selected");
    $("sequenceShapeSummary").textContent = "";
    sequenceState.cursor = null;
    return;
  }
  const pitchForNote = note => Number.isFinite(note?.ratio) && note.ratio > 0
    ? 12 * Math.log2(note.ratio)
    : Number(note?.semitone);
  const pitches = cycle.steps.flatMap(step => (Array.isArray(step.notes) ? step.notes : []))
    .map(pitchForNote).filter(Number.isFinite);
  const pitchMin = pitches.length ? Math.min(...pitches) : 0;
  const pitchMax = pitches.length ? Math.max(...pitches) : 0;
  const padding = pitchMax === pitchMin ? 1 : Math.max(.5, (pitchMax - pitchMin) * .08);
  const displayMin = pitchMin - padding;
  const displayMax = pitchMax + padding;
  const pitchFraction = pitch => Math.max(0, Math.min(1, (pitch - displayMin) / (displayMax - displayMin)));
  const length = Math.max(1 / 64, Number(cycle.lengthBeats) || 1);
  const fragment = document.createDocumentFragment();
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.classList.add("synthesis-sequence-contour");
  svg.setAttribute("viewBox", `0 0 ${length} 100`);
  svg.setAttribute("preserveAspectRatio", "none");
  svg.setAttribute("aria-hidden", "true");
  if (displayMin <= 0 && displayMax >= 0) {
    const root = document.createElementNS("http://www.w3.org/2000/svg", "line");
    root.classList.add("synthesis-sequence-root-line");
    const y = 92 - pitchFraction(0) * 84;
    root.setAttribute("x1", "0"); root.setAttribute("x2", String(length));
    root.setAttribute("y1", String(y)); root.setAttribute("y2", String(y));
    svg.append(root);
  }
  let path = "";
  let segmentOpen = false;
  for (const step of cycle.steps) {
    const stepPitches = (Array.isArray(step.notes) ? step.notes : []).map(pitchForNote).filter(Number.isFinite);
    if (!stepPitches.length) { segmentOpen = false; continue; }
    const average = stepPitches.reduce((sum, pitch) => sum + pitch, 0) / stepPitches.length;
    const x = Math.max(0, Math.min(length, sequenceStepAt(step) + Number(step.duration || 0) / 2));
    const y = 92 - pitchFraction(average) * 84;
    path += `${segmentOpen ? "L" : "M"}${x},${y}`;
    segmentOpen = true;
  }
  if (path) {
    const contour = document.createElementNS("http://www.w3.org/2000/svg", "path");
    contour.classList.add("synthesis-sequence-contour-line");
    contour.setAttribute("d", path);
    svg.append(contour);
  }
  fragment.append(svg);
  let rests = 0;
  let accents = 0;
  let noteCount = 0;
  cycle.steps.forEach((step, cursor) => {
    const cell = document.createElement("span");
    cell.className = "synthesis-sequence-step";
    cell.dataset.sequenceStep = String(cursor);
    cell.setAttribute("aria-hidden", "true");
    const notes = Array.isArray(step.notes) ? step.notes : [];
    const left = Math.max(0, Math.min(100, sequenceStepAt(step) / length * 100));
    const width = Math.max(.35, Math.min(100 - left, Number(step.duration || 0) / length * 100));
    cell.style.left = `${left}%`;
    cell.style.width = `${width}%`;
    if (!notes.length) { rests++; cell.classList.add("is-rest"); }
    if (notes.some(note => note.accent)) { accents++; cell.classList.add("is-accent"); }
    const labels = [];
    for (const note of notes) {
      const pitch = pitchForNote(note);
      if (!Number.isFinite(pitch)) continue;
      noteCount++;
      labels.push(`${pitch >= 0 ? "+" : ""}${pitch.toFixed(1)}`);
      const marker = document.createElement("span");
      marker.className = "synthesis-sequence-note" + (note.accent ? " is-accent" : "");
      marker.style.bottom = `${6 + pitchFraction(pitch) * 84}%`;
      marker.style.opacity = String(.45 + .55 * Math.max(0, Math.min(1, Number(note.velocity) || 0)));
      cell.append(marker);
    }
    cell.title = notes.length
      ? `Step ${cursor + 1} · tuned pitch ${labels.join(", ")} relative to base`
      : `Step ${cursor + 1} · rest`;
    fragment.append(cell);
  });
  const highLabel = document.createElement("span");
  highLabel.className = "synthesis-sequence-pitch-label synthesis-sequence-pitch-label--high";
  highLabel.textContent = `${pitchMax >= 0 ? "+" : ""}${pitchMax.toFixed(1)}`;
  highLabel.setAttribute("aria-hidden", "true");
  const lowLabel = document.createElement("span");
  lowLabel.className = "synthesis-sequence-pitch-label synthesis-sequence-pitch-label--low";
  lowLabel.textContent = `${pitchMin >= 0 ? "+" : ""}${pitchMin.toFixed(1)}`;
  lowLabel.setAttribute("aria-hidden", "true");
  fragment.append(highLabel, lowLabel);
  const pitchRange = pitches.length
    ? ` Tuned pitch offsets span ${pitchMin.toFixed(1)} to ${pitchMax.toFixed(1)} semitones.`
    : "";
  const mechanism = cycle.archetype.replaceAll("-", " ");
  strip.setAttribute("aria-label", `${cycle.label}. ${mechanism}. Time runs left to right and tuned pitch runs bottom to top. ${cycle.steps.length} steps, including ${rests} rests and ${accents} accented steps.${pitchRange} The highlighted column follows the audio clock.`);
  $("sequenceShapeSummary").textContent = `${mechanism} · ${noteCount} note event${noteCount === 1 ? "" : "s"} · tuned pitch ${pitchMin >= 0 ? "+" : ""}${pitchMin.toFixed(1)} to ${pitchMax >= 0 ? "+" : ""}${pitchMax.toFixed(1)} · ${Number(length.toFixed(2))} beats`;
  strip.replaceChildren(fragment);
  sequenceState.cursor = null;
}

function cursorForSequenceBeat(beat) {
  const cycle = sequenceState.cycle;
  if (!cycle?.steps.length || !(cycle.lengthBeats > 0)) return null;
  const relativeBeat = beat - audio.sequenceOriginBeat;
  const phase = ((relativeBeat % cycle.lengthBeats) + cycle.lengthBeats) % cycle.lengthBeats;
  let cursor = cycle.steps.length - 1;
  for (let index = 0; index < cycle.steps.length; index++) {
    if (sequenceStepAt(cycle.steps[index]) <= phase + 1e-9) cursor = index;
    else break;
  }
  return cursor;
}

function paintSequenceCursor() {
  if (!hasSequence() || !sequenceState.cycle) return;
  const status = sequenceState.workletStatus;
  const fromWorklet = audio.armed && status?.playing && status.studyId === sequenceState.id && Number.isInteger(status.cursor);
  const cursor = !playing ? null : fromWorklet ? status.cursor : cursorForSequenceBeat(audio.currentSequenceBeat());
  if (cursor === sequenceState.cursor) return;
  $("sequenceStrip").querySelector(".is-current")?.classList.remove("is-current");
  const cell = Number.isInteger(cursor) ? $("sequenceStrip").querySelector(`[data-sequence-step="${cursor}"]`) : null;
  if (cell) cell.classList.add("is-current");
  sequenceState.cursor = cursor;
  sequenceSurface?.setCursor(cursor);
}

function compileBasicSequence(item) {
  const gate = Number($("noteGate").value) / 100;
  const degrees = arpeggioDegrees(state.tuningId, item.mode);
  return {
    version: 1,
    studyId: item.id,
    label: item.label,
    kind: "arpeggiator",
    eraId: "basic",
    archetype: "ordered-chord",
    seed: 0,
    tempo: Number($("tempo").value),
    stepBeats: 1,
    lengthBeats: Math.max(1, degrees.length),
    settings: { gate, steps: degrees.length },
    steps: degrees.map((degree, index) => ({
      index, at: index, duration: 1,
      notes: [{ degree, velocity: .76, gate, accent: index === 0 }],
    })),
  };
}

function fitBasicRatio(ratio, rootFrequency = state.frequencyHz) {
  const tuning = getTuning(state.tuningId);
  let result = ratio;
  while (rootFrequency * result > 8000 && rootFrequency * result / tuning.periodRatio >= 20) result /= tuning.periodRatio;
  while (rootFrequency * result < 20 && rootFrequency * result * tuning.periodRatio <= 8000) result *= tuning.periodRatio;
  return result;
}

function mapCycleToTuning(cycle, { basic = false, rootFrequency = state.frequencyHz } = {}) {
  if (!cycle) return null;
  const ratioForNote = note => Number.isSafeInteger(note.degree)
    ? tuningRatioForDegree(note.degree, state.tuningId)
    : tuningRatioForSemitoneCoordinate(note.semitone, state.tuningId, sequenceState.pitchMode);
  const register = cycle.parameters?.fullTraversal || cycle.studyId === 'keyboard-range-arpeggio'
    ? sequenceRegisterMultiplier(cycle.steps.flatMap(step => step.notes.map(ratioForNote)),
      rootFrequency, getTuning(state.tuningId).periodRatio) ?? 1 : 1;
  const steps = cycle.steps.map(step => ({
    ...step,
    notes: step.notes.flatMap(note => {
      let ratio = ratioForNote(note) * register;
      // Preserve a playable note by translating whole tuning periods at the
      // register boundary. Small/non-octave maps can otherwise drop an entire
      // randomized phrase despite valid source notes.
      if (Number.isFinite(ratio) && ratio > 0) ratio = fitBasicRatio(ratio, rootFrequency);
      const frequency = rootFrequency * ratio;
      return Number.isFinite(ratio) && ratio > 0 && frequency >= 20 && frequency <= 8000
        ? [{ ...note, ratio }] : [];
    }),
  }));
  return { ...cycle, tuningId: state.tuningId, pitchMode: sequenceState.pitchMode, steps };
}

function compileSelectedSequence() {
  const study = sequenceStudy();
  const basic = selectedBasicSequence();
  const cycle = study ? compileSequence(study, {
    tempo: Number($("tempo").value),
    parameters: sequenceState.parameters,
  }) : basic ? compileBasicSequence(basic) : null;
  sequenceState.sourceCycle = cycle;
  sequenceState.cycle = mapCycleToTuning(cycle, { basic: !!basic });
  return sequenceState.cycle;
}

function cyclePitchKey(cycle) {
  return JSON.stringify(cycle?.steps.map(step => step.notes.map(note => note.ratio)) ?? []);
}

/** Retune an unchanged score without canceling its current voice or moving its sample-clock phase. */
function retuneSequenceRoot() {
  if (!sequenceState.cycle || !sequenceState.sourceCycle) return false;
  const remapped = mapCycleToTuning(sequenceState.sourceCycle, {
    basic: !!selectedBasicSequence(), rootFrequency: state.frequencyHz,
  });
  // At range boundaries a note can enter, leave, or octave-fold. That is a real
  // score change and still needs the ordinary sequence replacement path.
  if (cyclePitchKey(remapped) !== cyclePitchKey(sequenceState.cycle)) return false;
  sequenceState.cycle = remapped;
  sequenceSurface?.setValue(sequenceState.parameters, remapped);
  sequenceState.rootFrequency = state.frequencyHz;
  audio.setSequenceRootFrequency(state.frequencyHz);
  return true;
}

function rebuildSequence({ restart = false, route = true, audioState = null } = {}) {
  if (inputCategory === 'percussion') { syncDrumSequence({ restart, audioState }); paintPlayback(); return; }
  const cycle = compileSelectedSequence();
  sequenceSurface?.setValue(sequenceState.parameters, cycle);
  if (cycle) {
    if (playing && sequenceOwnsTransport()) {
      audio.swapSequence(cycle, { rootFrequency: state.frequencyHz, restart, state: audioState });
    } else {
      audio.setPlaying(false, Number($("tempo").value) / 60, Number($("noteGate").value) / 100);
      audio.setSequence(cycle, { rootFrequency: state.frequencyHz, preservePhase: !restart });
    }
    sequenceState.rootFrequency = state.frequencyHz;
  } else {
    audio.stopSequence();
    audio.setSequence(null, { preservePhase: false });
    if (activeSection === "synthesis") audio.setPlaying(playing, Number($("tempo").value) / 60, Number($("noteGate").value) / 100);
  }
  paintSequenceMetadata();
  paintSequenceStrip();
  paintPlayback();
  refreshSequencePresetSelection();
  if (route) updateUrl();
}

function syncDrumSequence({ restart = false, audioState = null } = {}) {
  const tempo = Number($("tempo").value);
  const cycle = compilePercussionSequence(drumPanel.getState(), tempo);
  const sound = audioState || configuredAudioState();
  if (playing) audio.swapSequence(cycle, { rootFrequency: 220, restart, state: sound });
  else { audio.configure(sound); audio.setPlaying(false); audio.setSequence(cycle, { preservePhase: !restart }); }
}

function updateTempo() {
  const tempo = Number($("tempo").value);
  if (sequenceOwnsTransport()) audio.setSequenceTempo(tempo);
  else audio.setPlaying(playing, tempo / 60, Number($("noteGate").value) / 100);
  refreshSequencePresetSelection();
  updateUrl();
}

function updateGate() {
  if (selectedBasicSequence()) rebuildSequence();
  else if (sequenceStudy()) return;
  else audio.setPlaying(playing, Number($("tempo").value) / 60, Number($("noteGate").value) / 100);
  fullPresets?.refresh();
}

function syncTransportForSection({ restartSequence = false } = {}) {
  const tempo = Number($("tempo").value), gate = Number($("noteGate").value) / 100;
  if (inputCategory === 'percussion') { syncDrumSequence({ restart: restartSequence }); return; }
  if (activeSection === "processing") {
    audio.stopSequence();
    audio.setPlaying(playing, tempo / 60, gate);
    return;
  }
  // Drums borrow the worklet score slot, not the remembered pitched score.
  // Restore it even when returning via a voice or another processing input.
  if (audio.sequence?.archetype === 'drum-grid') rebuildSequence({ route: false, audioState: configuredAudioState() });
  if (!hasSequence()) {
    audio.stopSequence();
    audio.setPlaying(playing, tempo / 60, gate);
    return;
  }
  audio.setPlaying(false, tempo / 60, gate);
  if (sequenceState.rootFrequency !== state.frequencyHz && sequenceState.cycle) {
    if (!retuneSequenceRoot()) rebuildSequence({ route: false });
  }
  if (!playing) { audio.stopSequence(); return; }
  if (restartSequence || !audio.sequencePlaying) {
    audio.startSequence({ tempo, rootFrequency: state.frequencyHz,
      ...(restartSequence ? { phase: 0 } : {}) });
  }
}

function updateUrl() {
  const params = new URLSearchParams(location.search);
  params.set("method", state.methodId);
  params.set("tuning", state.tuningId);
  if (state.presetId !== "custom") params.set("preset", state.presetId);
  else params.delete("preset");
  if (hasSequence()) {
    params.set("sequence", sequenceState.id);
    params.set("sequenceTempo", String(Number($("tempo").value)));
    params.set("sequenceDensity", String(Number(sequenceState.density.toFixed(2))));
    params.set("sequenceSwing", String(Number(sequenceState.swing.toFixed(2))));
    params.set("sequenceSeed", String(sequenceState.seed));
    params.set("sequencePitch", sequenceState.pitchMode);
    if (sequenceStudy() && sequenceState.parameters) params.set("sequenceParams", JSON.stringify(sequenceState.parameters));
    else params.delete("sequenceParams");
  } else {
    for (const key of ["sequence", "sequenceTempo", "sequenceDensity", "sequenceSwing", "sequenceSeed", "sequencePitch", "sequenceParams"]) params.delete(key);
  }
  history.replaceState(null, "", `${location.pathname}?${params}${location.hash}`);
}

function renderState(rebuildControls = true, audition = false, restoringSection = false) {
  const method = getMethod(state.methodId);
  const sectionChanged = activeSection !== methodSection(method.id);
  if (sectionChanged) {
    chooseControls.forEach(picker => { picker.details.open = false; });
    activeSection = methodSection(method.id);
    lastFactoryPreset = { ...sectionSessions[activeSection].lastFactoryPreset };
    if (!restoringSection) sectionSessions[activeSection].hasPresetInteraction = true;
    renderSection();
  }
  $("methodSelect").value = method.id;
  if (state.presetId !== "custom") lastFactoryPreset = { methodId: state.methodId, presetId: state.presetId };
  syncPresetToolbar();
  $("principle").textContent = method.principle;
  $("presetCue").textContent = state.presetId === "custom" ? "Custom settings. Next continues the preset tour." : getPreset(method.id, state.presetId).cue;
  $("methodInfoTitle").textContent = method.label;
  const amplitude = getAmplitudeModel(method);
  $("amplitudePrinciple").textContent = amplitude?.intrinsicExplanation ?? "";
  $("amplitudeHistory").textContent = amplitude?.historicalContext ?? "";
  $("amplitudeHostNote").textContent = amplitude?.hostEnvelope.explanation ?? "";
  if (renderState.envelopeMethod !== method.id) {
    $("envelopeDetails").open = !amplitude?.hostEnvelope.collapseByDefault;
    renderState.envelopeMethod = method.id;
  }
  $("methodInfoReference").href = `synthesaurus-reference.html#method-${method.id}`;
  const processing = method.kind === "processor";
  if (processing) {
    effectState = sanitizeState(state); if (!isVoiceInput(inputCategory) && inputCategory !== 'percussion') effectEnabled = true;
    if (inputCategory === "synthesis") { inputCategory = "signals"; processingInput = presetSignal(state.source); }
  } else inputCategory = "synthesis";
  paintVoiceInput();
  $("synthDetail").hidden = processing;
  if (processing && held.size) releaseAll();
  document.querySelector('.synthesis-tuning-choice').hidden = processing;
  $("arpDetail").hidden = processing;
  $("sequenceCompendium").hidden = processing;
  $("sequenceSelect").disabled = processing;
  $("nextSequence").disabled = processing;
  refreshSequencePresetSelection();
  if (processing) chooseControls.get("sequenceSelect")?.details && (chooseControls.get("sequenceSelect").details.open = false);
  $("nextMethod").title = processing ? "Next processor" : "Next synthesis method";
  $("nextMethod").setAttribute("aria-label", $("nextMethod").title);
  $("nextPreset").title = processing ? "Next processing preset" : "Next synthesis preset";
  $("nextPreset").setAttribute("aria-label", $("nextPreset").title);
  $("synthParameterHeading").textContent = processing ? "Processor parameters" : "Synth parameters";
  $("randomMethod").title = "Randomize settings for " + method.label + " only";
  $("randomMethod").setAttribute("aria-label", $("randomMethod").title);
  $("noteTiming").hidden = processing;
  $("transportTiming").hidden = processing && inputCategory !== 'percussion';
  $("soundControls").setAttribute("aria-label", processing ? "Processing controls" : "Synthesis controls");
  $("randomMethod").hidden = processing;
  $("envelopeDetails").hidden = processing;
  $("keyboardDetails").hidden = processing;
  $("voiceModeControl").hidden = processing;
  $("voiceMode").value = state.voiceMode;
  $("tuningSelect").value = state.tuningId;
  paintTuning();
  paintVoicing();
  paintEffect();
  $("restoreSource").hidden = processing;
  if (renderState.lastMethod && renderState.lastMethod !== method.id) {
    if (!processing || audio.input.pending || audio.captureRequest) { inputIntent++; loadingInput = false; audio.stopInput(); }
  }
  if (processing && processingSource() !== 0 && (audio.input.kind !== "none" || loadingInput)) {
    inputIntent++; loadingInput = false; audio.stopInput();
  }
  renderState.lastMethod = method.id;
  paintInput();
  $("playButton").setAttribute("aria-label", playing ? "Pause" : "Play");
  $("playButton").setAttribute("aria-pressed", String(playing));
  paintPlayback();
  $("sourceControls").hidden = inputCategory === 'percussion' || isVoiceInput(inputCategory) || !method.sourceInput && !processing;
  $("outputLevel").value = state.outputLevel;
  $("outputLevelOut").value = `${Math.round(state.outputLevel * 100)}%`;
  frequencyField.setValue(state.frequencyHz);
  envelopeEditor.setValue(state.envelope);
  paintEnvelopePreset();
  if (rebuildControls || processing) {
    controlFields.forEach(field => field?.destroy());
    methodGestureEditor?.destroy();
    const graphical = new Set((METHOD_EDITOR_SCHEMAS[method.id] || []).flatMap(editor => editor.kind === "xy" ? [editor.x, editor.y] : editor.ids));
    controlFields = (processing ? [] : method.controls).map((control, index) => graphical.has(control.id) ? null : createParameterControl(
      control, index, state.params[index], value => {
        state.params[index] = value;
        methodGestureEditor?.setValue(state.params);
        markCustom();
      },
    ));
    const articulation = new Set(amplitude?.intrinsicControlIds ?? []);
    const articulationIndexes = method.controls.map((control, index) => articulation.has(control.id) ? index : -1).filter(index => index >= 0);
    const layout = [
      ...(articulationIndexes.length ? [{ id: "articulation", label: amplitude.label, indexes: articulationIndexes }] : []),
      ...groupMethodControls(method).map(group => ({ ...group, indexes: group.indexes.filter(index => !articulationIndexes.includes(index)) })),
    ];
    const groups = layout.filter(group => group.indexes.some(index => controlFields[index])).map(group => {
      const section = document.createElement("section"); section.className = `synthesis-parameter-group is-${group.id}`;
      section.dataset.parameterGroup = group.id;
      const heading = document.createElement("h3"); heading.textContent = group.label;
      const grid = document.createElement("div"); grid.className = "synthesis-parameter-group-grid";
      grid.append(...group.indexes.map(index => controlFields[index]).filter(Boolean));
      section.append(heading, grid); return section;
    });
    $("methodControls").replaceChildren(...groups);
    methodGestureEditor = processing ? null : createMethodGestureEditor($("methodEditor"), method, state.params, changes => {
      for (const { index, value } of changes) {
        state.params[index] = value;
        controlFields[index]?.setValue(value);
      }
      markCustom();
    });
  } else {
    controlFields.forEach((field, index) => field?.setValue(state.params[index]));
    methodGestureEditor?.setValue(state.params);
  }
  chooseControls.forEach(picker => picker.refresh());
  if (!deferAudioSync) syncAudio(audition);
  if (!deferTransportSync) queueMicrotask(() => syncTransportForSection());
  if (processing) void ensureProcessingInput({ audition: audition && !isVoiceInput(inputCategory) });
  updateUrl();
  rememberSection();
  fullPresets?.refresh();
}

function renderSection() {
  const processing = activeSection === "processing";
  const name = processing ? "Processing" : "Synthesis";
  $("synthesis").dataset.section = activeSection;
  for (const button of document.querySelectorAll(".synthesis-sections button")) button.setAttribute("aria-pressed", String(button.dataset.section === activeSection));
  $("methodLabel").textContent = processing ? "Processor" : "Synthesis method";
  $("presetSectionLabel").textContent = name + " presets";
  const presetPicker = chooseControls.get("presetSelect");
  if (presetPicker) {
    presetPicker.destroy();
    chooseControls.set("presetSelect", enhanceChooseSelect($("presetSelect"), { label: `Choose ${name.toLowerCase()} preset` }));
  }
  const methods = SECTION_METHODS[activeSection];
  $("methodSelect").replaceChildren(...methods.map(method => new Option(
    processing ? method.label : `${method.label} · ${SYNTHESIS_DATES[method.id].dateLabel}`,
    method.id,
  )));
}

function switchSection(section) {
  if (section === activeSection || !sectionSessions[section]) return;
  rememberSection();
  state = sanitizeState({ ...sectionSessions[section].sound, outputLevel: state.outputLevel,
    voiceMode: state.voiceMode, tuningId: state.tuningId });
  renderState(true, true, true);
}
listen($("inputCategory"), "change", async () => {
  const category = $("inputCategory").value;
  clearTimeout(voiceRenderTimer); voiceSource.deactivate();
  inputIntent++; loadingInput = false; inputError = ""; audio.stopInput();
  inputCategory = category;
  if (category !== "synthesis") {
    effectEnabled = !isVoiceInput(category) && category !== 'percussion';
    processingInput = category === "samples" || category === "signals" ? inputSelections[category] : category;
    sectionSessions.processing.sound = captureSoundState(effectState);
  }
  switchSection(category === "synthesis" ? "synthesis" : "processing");
  paintVoiceInput(); paintVoicing(); paintEffect(); paintInput(); syncAudio(); syncTransportForSection(); paintPlayback();
  if (category === "microphone") {
    try { await connectInput(); } catch { paintInput(); }
  }
  else void ensureProcessingInput();
  fullPresets?.refresh();
});

listen($("methodSelect"), "change", () => {
  state = stateFromPreset($("methodSelect").value, null, state);
  renderState(true, true);
});
listen($("tuningSelect"), "change", () => {
  state.tuningId = sanitizeTuningId($("tuningSelect").value);
  $("tuningSelect").value = state.tuningId;
  paintTuning();
  paintVoicing();
  if (hasSequence()) rebuildSequence();
  syncAudio();
  rememberSection();
  fullPresets?.refresh();
});

function selectSequence(id, { parameters, tempo, restart = false, announce = true } = {}) {
  const previous = sequenceStudy();
  if (previous && sequenceState.parameters) sequenceParameterSessions.set(previous.id, sequenceState.parameters);
  const selected = SEQUENCE_STUDIES.find(study => study.id === id) || null;
  const basic = basicSequence(id);
  sequenceState.id = selected?.id || basic?.id || "none";
  sequenceState.workletStatus = null;
  if (selected) {
    syncSequenceParameterState(createSequenceParameterValues(selected,
      parameters ?? sequenceParameterSessions.get(selected.id)));
    tempoField.setValue(Number.isFinite(tempo) ? tempo : selected.defaults.tempoBpm);
    if (announce) $("status").textContent = `${selected.label} selected. Play uses this sequence without changing the current sound preset.`;
  } else if (basic) {
    syncSequenceParameterState(null);
    if (Number.isFinite(tempo)) tempoField.setValue(tempo);
    if (announce) $("status").textContent = `${basic.label} selected. It follows the current tuning without changing the synth preset.`;
  } else {
    syncSequenceParameterState(null);
    if (Number.isFinite(tempo)) tempoField.setValue(tempo);
    if (announce) $("status").textContent = "Direct note selected. Play uses the current sound’s hold or pulse behavior.";
  }
  $("sequenceSelect").value = sequenceState.id;
  chooseControls.get("sequenceSelect")?.refresh();
  paintSequenceParameterControls();
  rebuildSequence({ restart });
}

listen($("sequenceSelect"), "change", () => {
  selectSequence($("sequenceSelect").value, { restart: playing });
});

function applySequenceState(value = {}) {
  const input = value && typeof value === "object" ? value : {};
  const legacy = { root: "none", up: "basic-up", down: "basic-down", "up-down": "basic-up-down" }[input.arpMode];
  const id = typeof input.id === "string" ? input.id : legacy || "none";
  selectSequence(id, { parameters: input.parameters, tempo: input.tempo, announce: false });
}

function dispatchChoice(select, value) {
  if (!select || select.disabled || ![...select.options].some(option => option.value === value && !option.disabled)) return;
  select.value = value;
  select.dispatchEvent(new Event("change", { bubbles: true }));
}

function adjacentChoice(select, direction = 1) {
  const options = [...select.options].filter(option => !option.disabled && !option.hidden);
  if (!options.length) return null;
  const current = Math.max(0, options.findIndex(option => option.value === select.value));
  return options[(current + (direction < 0 ? -1 : 1) + options.length) % options.length].value;
}



function applyPreparedPerformance(performance, { message = "Instrument preset loaded." } = {}) {
  const prepared = captureInstrumentPreset(performance);
  const voice = isVoiceInput(prepared.routing.input);
  const previousMethod = state.methodId;
  const previousSection = activeSection;
  state = sanitizeState({ ...prepared.sound, voiceMode: voice ? state.voiceMode : prepared.voiceMode,
    tuningId: voice ? state.tuningId : prepared.tuningId, outputLevel: state.outputLevel });
  restoreSignalPath(prepared.routing);
  lastFactoryPreset = { methodId: state.methodId, presetId: state.presetId };
  if (!voice) {
    sequenceState.id = prepared.sequence.id;
    sequenceState.workletStatus = null;
    syncSequenceParameterState(prepared.sequence.parameters);
    tempoField.setValue(prepared.sequence.tempoBpm);
    gateField.setValue(prepared.sequence.gate);
  }
  $("sequenceSelect").value = sequenceState.id;
  const atomicSequenceChange = playing && (inputCategory === 'percussion' || hasSequence()
    && previousSection === "synthesis" && methodSection(state.methodId) === "synthesis");
  deferTransportSync = true;
  deferAudioSync = atomicSequenceChange;
  try { renderState(state.methodId !== previousMethod, false); }
  finally { deferTransportSync = false; deferAudioSync = false; }
  paintSequenceParameterControls();
  const nextAudioState = atomicSequenceChange ? configuredAudioState() : null;
  queueMicrotask(() => {
    rebuildSequence({ restart: playing, audioState: nextAudioState });
    // A score owns its own clock and leaves ordinary Play off. Hand that clock
    // back when recalling a processor or direct note, without changing the
    // performer's Play/Audio intent or interrupting an atomic score swap.
    if (!sequenceOwnsTransport()) syncTransportForSection();
  });
  $("status").textContent = message;
}

function currentPerformanceInput() {
  return captureInstrumentPreset({
    sound: state, voiceMode: state.voiceMode, tuningId: state.tuningId,
    routing: currentSignalPath(),
    sequence: { id: sequenceState.id, parameters: sequenceState.parameters,
      tempoBpm: Number($("tempo").value), gate: Number($("noteGate").value) },
  });
}

listen($("sequencePresetSelect"), "change", () => {
  const study = sequenceStudy();
  const recipe = $("sequencePresetSelect").value;
  if (!study || recipe === "custom") return;
  const next = applySequenceSettingsRecipe({
    id: study.id, parameters: sequenceState.parameters, tempoBpm: Number($("tempo").value),
  }, recipe);
  selectSequence(study.id, { parameters: next.parameters, tempo: next.tempoBpm, restart: playing, announce: false });
  $("status").textContent = `${createSequenceSettingsPresets(study).find(item => item.id.endsWith(`:${recipe}`))?.label || "Settings"} arpeggiator settings loaded without changing the synth or tuning.`;
});

listen($("nextSequencePreset"), "click", () => {
  const recipes = SEQUENCE_SETTING_RECIPES.map(recipe => recipe.id);
  const current = recipes.indexOf($("sequencePresetSelect").value);
  dispatchChoice($("sequencePresetSelect"), recipes[(current + 1) % recipes.length]);
});

listen($("randomSequencePreset"), "click", () => {
  const study = sequenceStudy();
  if (!study) return;
  const next = randomizeSequenceSettings({
    id: study.id, parameters: sequenceState.parameters, tempoBpm: Number($("tempo").value),
  });
  selectSequence(study.id, { parameters: next.parameters, tempo: next.tempoBpm, restart: playing, announce: false });
  $("status").textContent = `${study.label} settings randomized without changing the synth or tuning.`;
});

listen($("nextMethod"), "click", () => dispatchChoice($("methodSelect"), adjacentChoice($("methodSelect"))));
listen($("nextSequence"), "click", () => dispatchChoice($("sequenceSelect"), adjacentChoice($("sequenceSelect"))));

listen($("nextTuning"), "click", () => dispatchChoice($("tuningSelect"), nextTuningId(state.tuningId)));

listen($("envelopePresetSelect"), "change", () => {
  if ($("envelopePresetSelect").value !== "custom") applyEnvelopePreset($("envelopePresetSelect").value);
});
listen($("nextEnvelopePreset"), "click", () => {
  const current = matchEnvelopePreset(state.envelope);
  applyEnvelopePreset(nextEnvelopePreset(current?.id || "custom"));
});
listen($("randomEnvelope"), "click", () => {
  state = fitRandomAttackToSequence({ ...state, presetId: 'custom', envelope: randomizeEnvelope() }, currentPerformanceInput().sequence);
  envelopeEditor.setValue(state.envelope);
  markCustom(); paintEnvelopePreset(); syncAudio(true);
});


listen($("randomMethod"), "click", () => {
  state = fitRandomAttackToSequence(randomizeMethodState(state), currentPerformanceInput().sequence);
  renderState(false, true);
});
listen($("outputLevel"), "input", event => {
  state.outputLevel = Number(event.target.value);
  $("outputLevelOut").value = `${Math.round(state.outputLevel * 100)}%`;
  audio.state && (audio.state.outputLevel = state.outputLevel);
  audio.setLevel(state.outputLevel);
});

function basePlaybackStyle() {
  if (getMethod(state.methodId).kind === "processor") return "process";
  return getMethod(state.methodId).playStyle === "strike" || state.envelope.sustain <= .001 ? "strike" : "hold";
}
function playbackStyle() { return sequenceOwnsTransport() ? "sequence" : basePlaybackStyle(); }
function paintPlayback() {
  const style = playbackStyle();
  const repeats = style === "strike" || style === "sequence";
  const action = playing ? "Pause" : "Play";
  $("playButton").title = isVoiceInput(inputCategory) ? `${action} ${inputCategory === "speech" ? "speech phrase" : "singing score"}` : style === "process" ? `${action} processing demo` : style === "sequence" ? `${action} selected sequence` : repeats ? `${action} demo · pulse notes at the selected tempo` : `${action} demo · hold a continuous note`;
  $("tempoControl").title = $("gateControl").title = style === "sequence" ? "The selected sequence uses this tempo and note length" : repeats ? "Demo notes pulse at this tempo and note length" : "Tempo and note length apply to percussive or zero-sustain sounds";
  $("gateControl").hidden = !!sequenceStudy();
  tempoField.setDisabled(!repeats);
  gateField.setDisabled(!repeats || !!sequenceStudy());
}
function setPlaying(value) {
  playing = !!value;
  if (!playing && isVoiceInput(inputCategory)) { clearTimeout(voiceRenderTimer); voiceSource.pause(); }
  const tempo = Number($("tempo").value), gate = Number($("noteGate").value) / 100;
  if (sequenceOwnsTransport()) {
    audio.setPlaying(false, tempo / 60, gate);
    if (playing && !audio.sequencePlaying) audio.startSequence({ tempo, rootFrequency: state.frequencyHz });
    else if (!playing) audio.stopSequence();
  } else {
    audio.stopSequence();
    audio.setPlaying(playing, tempo / 60, gate);
  }
  $("playButton").setAttribute("aria-pressed", String(playing));
  $("playButton").setAttribute("aria-label", playing ? "Pause" : "Play");
  paintPlayback();
}
listen($("playButton"), "click", () => { setPlaying(!playing); if (playing) void ensureProcessingInput(); });
function trigger() {
  if (!audio.armed) { $("status").textContent = "Enable Audio to hear the demonstration."; return; }
  const processing = getMethod(state.methodId).kind === "processor";
  if (inputCategory === 'percussion') { drumPanel.hit(drumPanel.getState().selectedLane); return; }
  if (isVoiceInput(inputCategory)) { void ensureProcessingInput({ audition: true, restart: true }); return; }
  if (processing && ["demo", "file"].includes(selectedInput()?.kind)) {
    void ensureProcessingInput({ audition: true, restart: true });
    return;
  }
  const poly = state.voiceMode === "poly" && !processing;
  const duration = Math.min(state.envelope.points ? 64.2 : 24.2, envelopeGateSeconds(state.envelope) + .18);
  const at = audio.context.currentTime + .005;
  const degrees = poly ? getTuning(state.tuningId).chordDegrees : [0];
  for (const frequency of demonstrationFrequencies(degrees)) audio.noteOn(frequency, 0.8, duration, null, at);
}
listen($("triggerButton"), "click", trigger);

function demonstrationFrequencies(degrees) {
  const tuning = getTuning(state.tuningId);
  const result = degrees.map(degree => {
    const ratio = tuningRatioForDegree(degree, state.tuningId);
    return Number.isFinite(ratio) ? state.frequencyHz * ratio : NaN;
  });
  if (!result.length || !result.every(Number.isFinite)) return [];
  while (Math.max(...result) > 8000 && Math.min(...result) / tuning.periodRatio >= 20) {
    result.forEach((frequency, index) => { result[index] = frequency / tuning.periodRatio; });
  }
  while (Math.min(...result) < 20 && Math.max(...result) * tuning.periodRatio <= 8000) {
    result.forEach((frequency, index) => { result[index] = frequency * tuning.periodRatio; });
  }
  return result.every(frequency => frequency >= 20 && frequency <= 8000) ? result : [];
}

function paintVoicing() {
  const processing = getMethod(state.methodId).kind === "processor";
  $("triggerButton").textContent = inputCategory === 'percussion' ? 'Hit pad' : isVoiceInput(inputCategory) ? "Preview voice" : processing ? "Audition · 3 s" : state.voiceMode === "poly" ? "Trigger Notes (poly)" : "Trigger Note";
  $("triggerButton").title = inputCategory === 'percussion' ? 'Strike the selected drum without changing Play' : isVoiceInput(inputCategory) ? "Play this voice phrase once without changing Play" : processing ? "Audition the selected input for three seconds" : state.voiceMode === "poly" ? "Play a three-note chord from the selected tuning and note map" : "Play one note at the selected frequency";
  $("keyboardHelp").textContent = `Consecutive notes from ${getTuning(state.tuningId).label}, relative to the frequency above. Hold keys or note buttons. ${state.voiceMode === "poly" ? "Up to eight notes sound together, each with its own envelope." : "The most recent held note sounds."}`;
  for (const [code, button] of keyButtons) {
    const available = Number.isFinite(frequencyForTuningDegree(state.frequencyHz, offsets[code], state.tuningId, { minHz: 20, maxHz: 8000 }));
    button.disabled = !available;
    button.setAttribute("aria-label", `Key ${button.textContent}, degree ${offsets[code]} in ${getTuning(state.tuningId).label}${available ? "" : ", outside the playable frequency range"}`);
  }
}
listen($("voiceMode"), "change", () => {
  state.voiceMode = $("voiceMode").value === "poly" ? "poly" : "mono";
  paintVoicing();
  syncAudio();
  fullPresets?.refresh();
});
function press(id, frequency, velocity = 0.75) {
  if (!Number.isFinite(frequency)) { $("status").textContent = "That mapped note is outside the 20 to 8,000 hertz playable range."; return; }
  if (getMethod(state.methodId).kind === "processor" || held.has(id) || held.size >= 128) return;
  const noteId = noteSequence = noteSequence % 0x7ffffffe + 1;
  held.set(id, { frequency, velocity, noteId });
  keyButtons.get(id)?.classList.add("is-held");
  audio.noteOn(frequency, velocity, null, noteId);
}
function release(id) {
  const note = held.get(id);
  if (!note) return;
  held.delete(id);
  keyButtons.get(id)?.classList.remove("is-held");
  audio.noteOff(note.noteId);
}
function releaseAll() { held.clear(); keyButtons.forEach(button => button.classList.remove("is-held")); audio.noteOff(); }
const entries = Object.entries(offsets);
for (let row = 0; row < 2; row++) {
  const element = document.createElement("div"); element.className = "synthesis-key-row";
  for (const [code, offset] of entries.slice(row * 12, row * 12 + 12)) {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = code.replace("Key", "").replace("Digit", "");
    button.setAttribute("aria-label", `Key ${button.textContent}, degree ${offset} in ${getTuning(state.tuningId).label}`);
    const start = () => press(code, frequencyForTuningDegree(state.frequencyHz, offset, state.tuningId, { minHz: 20, maxHz: 8000 }));
    listen(button, "pointerdown", event => { event.preventDefault(); button.setPointerCapture(event.pointerId); start(); });
    listen(button, "pointerup", () => release(code));
    listen(button, "pointercancel", () => release(code));
    listen(button, "lostpointercapture", () => release(code));
    listen(button, "keydown", event => { if ((event.key === " " || event.key === "Enter") && !event.repeat) { event.preventDefault(); start(); } });
    listen(button, "keyup", event => { if (event.key === " " || event.key === "Enter") { event.preventDefault(); release(code); } });
    keyButtons.set(code, button); element.append(button);
  }
  $("keyboard").append(element);
}
const editable = target => target?.closest?.("input,select,textarea,button,[contenteditable=true]");
listen(document, "keydown", event => {
  if (inputCategory === 'percussion' && !event.repeat && !event.ctrlKey && !event.metaKey && !event.altKey && !editable(event.target) && DRUM_KEYS.includes(event.code)) {
    event.preventDefault(); drumPanel.hit(DRUM_KEYS.indexOf(event.code)); return;
  }
  if (event.repeat || event.ctrlKey || event.metaKey || event.altKey || editable(event.target) || !(event.code in offsets)) return;
  event.preventDefault(); press(event.code, frequencyForTuningDegree(state.frequencyHz, offsets[event.code], state.tuningId, { minHz: 20, maxHz: 8000 }));
});
listen(document, "keyup", event => { if (held.has(event.code)) release(event.code); });
listen(window, "blur", () => { if (held.size) releaseAll(); });
listen(document, "visibilitychange", () => { if (document.hidden && held.size) releaseAll(); });
listen(window, "morphazoid:midi-input", event => {
  const { message, routeId, source } = event.detail ?? {};
  if (!message || (routeId && routeId !== "synthesis")) return;
  if (source === "wax" && document.documentElement.dataset.morphazoidWaxOutputMode === "midi") return;
  if (source === "wax" && getMethod(state.methodId).kind === "processor" && inputCategory !== 'percussion') return;
  if (inputCategory === 'percussion' && message.type === 'noteOn' && Number(message.velocity) > 0) {
    event.preventDefault(); const lane = DRUM_MIDI_NOTES.indexOf(Number(message.note));
    if (lane < 0) return;
    if (source === 'wax' && !audio.armed) {
      // Host MIDI may explicitly arm Audio. Keep only the latest initial hit
      // per pad, and never replay it after a source change or panic.
      pendingHostDrums = pendingHostDrums.filter(hit => hit.lane !== lane);
      pendingHostDrums.push({ lane, velocity: message.velocity / 127, intent: inputIntent });
      if (!arming) $("audioButton").click();
    } else drumPanel.hit(lane, message.velocity / 127);
    return;
  }
  const id = `midi:${message.sourceId || "default"}:${message.channel || 0}:${message.note}`;
  if (message.type === "noteOn" && Number(message.velocity) > 0) {
    event.preventDefault();
    press(id, frequencyForMidiNote(message.note, state.tuningId,
      { anchorNote: 69, anchorHz: 440, minHz: 20, maxHz: 8000 }), message.velocity / 127);
    if (source === "wax" && !audio.armed && !arming) $("audioButton").click();
  }
  else if (message.type === "noteOff" || message.type === "noteOn" && Number(message.velocity) <= 0) { event.preventDefault(); release(id); }
  else if (message.type === "panic" || (message.type === "controlChange" && [120, 123].includes(message.controller))) { event.preventDefault(); pendingHostDrums = []; releaseAll(); setPlaying(false); audio.panic(); }
});
function processingSource() {
  return inputCategory === 'percussion' || isVoiceInput(inputCategory) ? 0 : getProcessingInput(processingInput)?.source ?? 0;
}
function currentSignalPath() {
  return sanitizeSignalPath({ input: inputCategory, selection: processingInput, loop: audio.input.loop, effectEnabled, effect: effectState,
    ...(isVoiceInput(inputCategory) ? { voice: voicePanel.getState() } : {}),
    ...(inputCategory === 'percussion' ? { percussion: drumPanel.getState() } : {}) }, state);
}
function restoreSignalPath(value) {
  const route = sanitizeSignalPath(value, state);
  clearTimeout(voiceRenderTimer);
  if (route.input !== inputCategory) voiceSource.deactivate();
  else voiceSource.invalidate();
  inputIntent++; loadingInput = false; audio.stopInput();
  inputCategory = route.input; processingInput = route.selection ?? (isVoiceInput(route.input) ? route.input : "noise");
  if (isVoiceInput(inputCategory)) { voicePanel.setInput(inputCategory); voicePanel.applyState(route.voice); }
  if (inputCategory === 'percussion') drumPanel.setValue(route.percussion);
  audio.input.setLoop(route.loop);
  effectEnabled = route.effectEnabled; effectState = sanitizeState({ ...route.effect, outputLevel: state.outputLevel });
  if (inputCategory === "samples" || inputCategory === "signals") inputSelections[inputCategory] = processingInput;
  sectionSessions.processing.sound = captureSoundState(effectState);
}
function selectedInput() { return inputCategory === 'percussion' || isVoiceInput(inputCategory) ? null : getProcessingInput(processingInput); }
function paintInput() {
  const status = audio.input.status();
  const method = getMethod(state.methodId);
  const processing = method.kind === "processor";
  const fileSynthesis = !processing && Boolean(method.sourceInput);
  if (inputControl?.root) {
    inputControl.root.hidden = !fileSynthesis && !(processing && ["microphone", "file"].includes(inputCategory));
    const micOption = inputControl.root.sourceSelect?.querySelector('option[value="mic"]');
    if (micOption) { micOption.hidden = !processing; micOption.disabled = !processing; }
    if (inputControl.root.sourceSelect) inputControl.root.sourceSelect.hidden = true;
    if (fileSynthesis) {
      inputControl.root.sourceSelect && (inputControl.root.sourceSelect.value = "file");
      inputControl.root.setSource?.("file");
    }
  }
  const option = selectedInput();
  const external = processing && processingSource() === 0;
  const loopable = isVoiceInput(inputCategory) || processing && ["demo", "file"].includes(option?.kind);
  $("processingLoopControl").hidden = !loopable;
  $("processingLoop").checked = status.loop;
  const microphone = external && option?.kind === "microphone";
  $("frequencyRow").hidden = processing && [0, 3, 8, 9, 10].includes(processingSource());
  const pitchHost = processing ? $("inputBar") : document.querySelector(".synthesis-synth-essentials");
  if ($("frequencyRow").parentNode !== pitchHost) pitchHost.append($("frequencyRow"));
  frequencyField.labelElement.textContent = processing ? "Signal pitch" : "Frequency";
  $("sourceName").hidden = processing;
  $("sourceName").textContent = synthesisSourceName;
  $("inputCategory").value = inputCategory;
  chooseControls.get("inputCategory")?.refresh();
  $("inputSelectionField").hidden = !["samples", "signals"].includes(inputCategory);
  $("inputSelectionLabel").textContent = inputCategory === "samples" ? "Sample loop" : "Test signal";
  const options = inputsForCategory(inputCategory);
  if ($("processingSource").dataset.category !== inputCategory) {
    $("processingSource").replaceChildren(...options.map(item => new Option(item.label, item.id)));
    $("processingSource").dataset.category = inputCategory;
  }
  $("processingSource").value = processingInput;
  chooseControls.get("processingSource")?.refresh();
  if (inputGainField) {
    const inStrip = !inputControl.root.hidden;
    const host = inStrip ? inputControl.root : $("inputGainControl");
    if (inputGainField.parentNode !== host) host.prepend(inputGainField);
    $("inputGainControl").hidden = inStrip;
  }
  $("sourceControls").hidden = inputCategory === 'percussion' || isVoiceInput(inputCategory) || !processing && !fileSynthesis;
  paintSignalPath();
  $("processingInputHint").textContent = isVoiceInput(inputCategory) ? "Voicesaurus renders this voice through the shared output. Play follows Loop input; Preview voice plays the complete phrase once."
    : option?.kind === "microphone" ? "Mic / audio-in stays selected. Choose the hardware device in Audio Settings."
    : loopable ? (status.loop ? "Play loops the full input; Audition previews 3 s." : "Play runs the input once; Replay starts it again.")
    : "This input stays selected across presets and dice. Play runs it; Audition previews 3 s.";
  $("inputStatus").textContent = loadingInput ? "Loading " + option?.label + "…" : status.kind !== "none" || status.pending ? status.label
    : external && !audio.armed ? "Enable Audio to use " + (option?.label ?? "mic / audio-in")
    : external ? (status.ended ? "Input finished · Replay to hear it again" : option?.kind === "demo" ? "Sample ready to load" : "Input stopped")
    : processing ? (PROCESSING_SCHEMA.sources[processingSource()] ?? "Built-in signal") : status.label;
  $("stopInput").hidden = processing && !external;
  $("stopInput").disabled = !loadingInput && !status.pending && status.kind === "none";
  $("sourceFileLabel").hidden = processing && option?.kind !== "file";
  $("sourceFile").disabled = arming;
  $("resumeFile").hidden = !processing || !external || (option?.kind !== "demo" && !(option?.kind === "file" && audio.processingFile));
  $("resumeFile").textContent = option?.kind === "demo" ? "Restart sample" : "Replay file";
  $("resumeFile").disabled = !audio.armed || loadingInput;
  $("inputHelp").hidden = processing && !microphone;
  $("inputLevel").hidden = !external && processing;
  inputControl?.refresh();
}
$("inputSourceHost").append($("sourceControls"));
async function ensureProcessingInput({ audition = false, connectMic = false, restart = false, force = false } = {}) {
  if (!audio.armed || getMethod(state.methodId).kind !== "processor") { paintInput(); return; }
  if (isVoiceInput(inputCategory)) {
    const ready = await voiceSource.update(voicePanel.getState(), { playing, loop: audio.input.loop, audition, restart, force });
    if (ready) $("audioError").hidden = true;
    return ready;
  }
  const option = selectedInput();
  if (!option || option.kind === "signal" || loadingInput) return;
  const intent = inputIntent;
  try {
    if (option.kind === "demo") {
      if (audio.demoId !== option.id || !audio.input.status().hasFile) {
        loadingInput = true; paintInput();
        const loaded = await audio.loadDemo(option.id);
        if (!loaded || intent !== inputIntent) return;
      } else if (restart || audio.input.kind === "none") audio.startFile();
    } else if (option.kind === "file") {
      if (restart || audio.input.kind === "none") audio.startUserFile();
    } else if (connectMic) {
      if (!await audio.startMicrophone() || intent !== inputIntent) return;
    }
    if (intent === inputIntent && audition) syncAudio(true);
    $("audioError").hidden = true;
  } catch (error) { if (intent === inputIntent && error.name !== "AbortError") inputError = error?.message || "Input unavailable"; }
  finally { if (intent === inputIntent) { loadingInput = false; paintInput(); } }
}
listen($("processingLoop"), "change", () => {
  audio.input.setLoop($("processingLoop").checked);
  if (playing) void ensureProcessingInput();
  fullPresets?.refresh();
});
listen($("processingSource"), "change", () => {
  processingInput = $("processingSource").value;
  inputSelections[inputCategory] = processingInput;
  inputIntent++; loadingInput = false; audio.stopInput();
  paintInput(); syncAudio(processingSource() !== 0);
  void ensureProcessingInput({ audition: true });
  fullPresets?.refresh();
});
listen($("sourceFile"), "change", async event => {
  const file = event.target.files?.[0];
  if (!file) return;
  const intent = ++inputIntent;
  inputError = "";
  try {
    const processing = getMethod(state.methodId).kind === "processor";
    loadingInput = processing; paintInput();
    await audio.start({ arm: false });
    if (intent !== inputIntent) return;
    const label = await audio.loadFile(file, { processing });
    if (intent !== inputIntent) return;
    if (!processing) synthesisSourceName = label;
    else processingInput = "file";
    paintInput(); syncAudio(true); $("audioError").hidden = true;
  } catch (error) { if (intent === inputIntent) inputError = error?.message || "Input unavailable"; }
  finally { if (intent === inputIntent) { loadingInput = false; paintInput(); } }
  event.target.value = "";
});
listen($("restoreSource"), "click", () => { inputIntent++; synthesisSourceName = "Built-in synthetic source"; audio.restoreSource(); paintInput(); });
listen($("processingBypass"), "change", () => { effectState.bypass = $("processingBypass").checked; effectState.presetId = "custom"; updateEffect(); });
async function connectInput() {
  inputError = "";
  const methodId = state.methodId;
  const intent = inputIntent;
  try {
    await audio.start({ arm: false });
    if (intent !== inputIntent) return;
    if (inputCategory === "file" || getMethod(methodId).kind !== "processor") {
      if (getMethod(methodId).kind === "processor") {
        if (audio.processingFile) audio.input.setFile(audio.processingFile.buffer, audio.processingFile.label);
        else if (audio.input.fileBuffer) audio.input.startFile();
        else $("sourceFile").click();
      } else $("sourceFile").click();
      return;
    }
    if (getMethod(methodId).kind === "processor") {
      if (processingInput !== "microphone") { processingInput = "microphone"; inputIntent++; paintInput(); syncAudio(); }
      await audio.startMicrophone();
      if (audio.input.kind === "microphone") setPlaying(true);
    } else {
      const label = await audio.captureSource();
      if (label && state.methodId === methodId) { synthesisSourceName = label; paintInput(); syncAudio(true); }
    }
    $("audioError").hidden = true;
  } catch (error) { inputError = error?.message || "Input unavailable"; throw error; }
}
inputControl = mountAudioInputControl({
  container: $("sourceControls"), before: $("sourceFileLabel"), placement: false,
  button: $("startMicrophone"), gainInput: mixFields.inputDb.input, gainOutput: mixFields.inputDb.output,
  gainFormat: value => `${value > 0 ? "+" : ""}${value} dB`,
  gainMultiplier: () => 10 ** ((effectState.inputDb ?? 0) / 20),
  sources: [{ value: "mic", label: "Mic" }, { value: "file", label: "File" }], fileInput: $("sourceFile"),
  getState: () => {
    const method = getMethod(state.methodId);
    const processing = method.kind === "processor";
    return { active: audio.input.kind !== "none", pending: audio.input.pending || loadingInput, error: inputError,
      supported: Boolean(method.sourceInput || processing && ["microphone", "file"].includes(inputCategory)),
      source: !processing || audio.input.kind === "file" || processingInput === "file" ? "file" : "mic" };
  },
  getSignal: () => ({ node: audio.input.node, stream: audio.input.stream,
    channels: audio.input.kind === "file" ? audio.input.fileBuffer?.numberOfChannels : undefined }),
  onStart: connectInput,
  onStop: () => { inputIntent++; loadingInput = false; inputError = ""; audio.stopInput(); paintInput(); },
  onSourceChange: value => {
    inputError = "";
    inputIntent++; loadingInput = false; audio.stopInput();
    processingInput = value === "file" ? "file" : "microphone"; inputCategory = processingInput;
    paintInput(); syncAudio();
  },
  hide: [$("sourceFileLabel"), $("stopInput"), $("resumeFile"), $("inputStatus"), $("inputLevel"), $("inputHelp"), $("inputGainControl")],
});
inputGainField = inputControl.root.querySelector(".mz-input-gain");
$("inputGainControl").replaceChildren();
$("inputGainControl").classList.remove("mz-input-legacy");



const scope = $("scope"), spectrum = $("spectrum");
const scopeContext = scope.getContext("2d", { alpha: false });
const spectrumContext = spectrum.getContext("2d", { alpha: false });
// Keep history independent of canvas size so rotation and Freeze retain it.
const historyCanvas = document.createElement("canvas");
historyCanvas.width = 240; historyCanvas.height = 160;
const historyContext = historyCanvas.getContext("2d", { alpha: false });
background(historyContext, historyCanvas.width, historyCanvas.height);
const analysisResize = new ResizeObserver(() => {
  const dock = $("performanceDock");
  const height = Math.ceil(dock.getBoundingClientRect().height);
  document.documentElement.style.setProperty("--synthesis-analysis-inset", height + "px");
  analysisDirty = true;
});
analysisResize.observe($("performanceDock"));
function resize(canvas) {
  const rect = canvas.getBoundingClientRect(), dpr = Math.min(2, devicePixelRatio || 1);
  const w = Math.max(1, Math.round(rect.width * dpr)), h = Math.max(1, Math.round(rect.height * dpr));
  if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; return true; }
  return false;
}
function background(ctx, w, h) { ctx.fillStyle = "#0b100d"; ctx.fillRect(0, 0, w, h); }
function canvasSpace(canvas, context) {
  const dpr = Math.min(2, devicePixelRatio || 1);
  context.setTransform(dpr, 0, 0, dpr, 0, 0);
  return { width: canvas.width / dpr, height: canvas.height / dpr };
}
function drawScope() {
  const ctx = scopeContext, { width: w, height: h } = canvasSpace(scope, ctx);
  background(ctx, w, h);
  const overlay = $("spectrumOverlay").checked;
  const left = overlay ? 27 : 8, right = w - 8, top = 10, bottom = h - 19;
  const range = 2 ** Math.ceil(Math.log2(lastPeak));
  if (overlay) {
    drawChaoticSpectrum(ctx, barSpectrum, { left, right, spectrumTop: top, spectrumBottom: bottom }, {
      barFill: "rgba(225, 167, 87, 0.24)", barCap: "rgba(240, 187, 113, 0.85)",
      fontSize: 9, frequencyTicks: w < 260 ? [20, 1000, 20000] : [20, 100, 1000, 10000, 20000], label: "",
    });
  } else {
    ctx.strokeStyle = "#223329"; ctx.lineWidth = 1;
    for (const fraction of [0.15, 0.5, 0.85]) { const y = top + (bottom - top) * fraction; ctx.beginPath(); ctx.moveTo(left, y); ctx.lineTo(right, y); ctx.stroke(); }
    ctx.fillStyle = "#97a89f"; ctx.font = "10px monospace";
    ctx.fillText("±" + range.toFixed(range < .1 ? 3 : 2), left + 2, top + 10);
  }
  const rate = barSpectrum.sampleRate;
  const span = Math.min(3000, Math.max(128, Math.round(rate / displayFrequency * 3)));
  let start = 0;
  for (let i = 1; i < Math.min(800, displayWave.length - span); i++) { if (displayWave[i - 1] <= 0 && displayWave[i] > 0) { start = i; break; } }
  ctx.beginPath();
  for (let x = 0; x <= right - left; x++) {
    const value = displayWave[Math.min(displayWave.length - 1, start + Math.floor(x / (right - left) * span))];
    const y = top + (bottom - top) * (0.5 - Math.max(-1, Math.min(1, value / range)) * 0.42);
    if (x === 0) ctx.moveTo(left + x, y); else ctx.lineTo(left + x, y);
  }
  if (overlay) { ctx.strokeStyle = "#0b100dee"; ctx.lineWidth = 3.8; ctx.stroke(); }
  ctx.strokeStyle = "#b8f4ce"; ctx.lineWidth = 1.4; ctx.stroke();
  ctx.fillStyle = "#97a89f"; ctx.font = "9px monospace"; ctx.textAlign = "right";
  ctx.fillText(overlay ? "Hz" : (1000 * span / rate).toFixed(1) + " ms", right, overlay ? 8 : h - 3);
  ctx.textAlign = "left";
}
function dbAt(ratio) {
  const rate = barSpectrum.sampleRate, high = Math.min(20000, rate / 2);
  return frequencies[Math.max(0, Math.min(frequencies.length - 1, Math.round(20 * Math.exp(Math.log(high / 20) * ratio) / (rate / 2) * frequencies.length)))];
}
function updateHistory() {
  const ctx = historyContext, w = historyCanvas.width, h = historyCanvas.height;
  ctx.drawImage(historyCanvas, 1, 0, w - 1, h, 0, 0, w - 1, h);
  for (let y = 0; y < h; y++) {
    const value = Math.max(0, Math.min(1, (dbAt(1 - y / h) + 100) / 85));
    ctx.fillStyle = "rgb(" + Math.round(10 + value ** 2 * 200) + "," + Math.round(18 + value * 195) + "," + Math.round(12 + value ** 0.8 * 128) + ")";
    ctx.fillRect(w - 1, y, 1, 1);
  }
}
function drawSpectrum() {
  const ctx = spectrumContext, { width: w, height: h } = canvasSpace(spectrum, ctx);
  background(ctx, w, h);
  const logSpan = Math.log(Math.min(20000, barSpectrum.sampleRate / 2) / 20);
  if ($("spectrumMode").value === "spectrogram") {
    const left = 29, bottom = h - 15;
    ctx.drawImage(historyCanvas, left, 0, w - left, bottom);
    ctx.font = "9px monospace"; ctx.fillStyle = "#a1b8aa";
    for (const f of [30, 100, 1000, 10000]) ctx.fillText(f >= 1000 ? f / 1000 + "k" : String(f), 3, Math.max(9, bottom * (1 - Math.log(f / 20) / logSpan)));
    ctx.fillText("Hz", 3, h - 3); ctx.textAlign = "right"; ctx.fillText("Time →", w - 4, h - 3); ctx.textAlign = "left";
  } else {
    const left = 27, right = w - 8, top = 10, bottom = h - 19;
    drawChaoticSpectrum(ctx, barSpectrum, { left, right, spectrumTop: top, spectrumBottom: bottom }, {
      barFill: "rgba(225, 167, 87, 0.24)", barCap: "rgba(240, 187, 113, 0.85)",
      fontSize: 9, frequencyTicks: w < 260 ? [20, 1000, 20000] : [20, 100, 1000, 10000, 20000], label: "",
    });
  }
}
listen($("spectrumMode"), "change", () => {
  const gram = $("spectrumMode").value === "spectrogram";
  $("spectrumLegend").textContent = gram ? "Time → · frequency ↑" : "Frequency → · dBFS ↑";
  spectrum.setAttribute("aria-label", gram ? "Live logarithmic frequency spectrogram" : "Live logarithmic frequency spectrum");
  analysisDirty = true;
});
listen($("spectrumOverlay"), "change", () => {
  const overlay = $("spectrumOverlay").checked;
  $("scopeTitle").textContent = overlay ? "Scope + spectrum" : "Oscilloscope";
  scope.setAttribute("aria-label", overlay ? "Live output waveform over a logarithmic frequency spectrum" : "Live output waveform");
  analysisDirty = true;
});
listen($("freezeDisplay"), "change", () => { analysisDirty = true; });
function animate(now) {
  frames = requestAnimationFrame(animate);
  if (document.hidden || now - lastDraw < 33) return;
  lastDraw = now;
  paintSequenceCursor();
  if (inputCategory === 'percussion') {
    const status = audio.getSequenceStatus();
    drumPanel.progress(playing && audio.armed ? status?.stepIndex : null);
  }
  if (isVoiceInput(inputCategory)) voicePanel.progress(voiceSource.player.currentPosition(), voiceSource.timings, voiceSource.player.playing && voiceSource.timingsCurrent);
  const scopeResized = resize(scope), spectrumResized = resize(spectrum);
  const frozen = $("freezeDisplay").checked;
  if (audio.armed && audio.analyser) audio.analyser.getFloatTimeDomainData(wave);
  else wave.fill(0);
  let peak = 0, sum = 0;
  for (const value of wave) { peak = Math.max(peak, Math.abs(value)); sum += value * value; }
  const rms = Math.sqrt(sum / wave.length);
  $("levelReadout").value = rms > 1e-6 ? (20 * Math.log10(rms)).toFixed(1) + " dBFS" : "−∞ dBFS";
  $("signalStatus").textContent = arming ? "Starting…" : !audio.armed ? "Audio off" : peak > 0.0001 ? "Sounding" : "Ready";
  if (!frozen) {
    displayWave.set(wave); displayFrequency = state.frequencyHz;
    lastPeak = Math.max(0.01, peak * 1.15, lastPeak * 0.95);
    if (audio.armed && audio.analyser) updateChaoticSpectrum(barSpectrum, audio.analyser);
    else { frequencies.fill(-Infinity); barSpectrum.displayData.fill(-100); barSpectrum.frames = 0; }
    updateHistory();
  }
  if (!frozen || scopeResized || spectrumResized || analysisDirty) {
    drawScope(); drawSpectrum(); analysisDirty = false;
  }
  if (audio.input.analyser && audio.input.kind !== "none") {
    audio.input.analyser.getFloatTimeDomainData(inputWave);
    const peak = inputWave.reduce((peak, value) => Math.max(peak, Math.abs(value)), 0);
    $("inputLevel").value = peak > 1e-6 ? "Input " + (20 * Math.log10(peak)).toFixed(1) + " dBFS peak" : "Input −∞ dBFS";
  } else $("inputLevel").value = "Input −∞ dBFS";
}

// Small public host/debug seam: serializable musical state, never browser nodes.
window.MorphazoidSynthesis = Object.freeze({
  getState: () => structuredClone({ ...state, routing: currentSignalPath() }),
  getSequenceState: () => structuredClone({ version: 1, id: sequenceState.id, tempo: Number($("tempo").value), density: sequenceState.density,
    swing: sequenceState.swing, seed: sequenceState.seed, pitchMode: sequenceState.pitchMode,
    parameters: sequenceState.parameters, cycle: sequenceState.cycle }),
  applyState(value) {
    state = sanitizeState(value);
    if (value?.routing) restoreSignalPath(value.routing);
    renderState();
    if (value?.arpMode) applySequenceState({ arpMode: value.arpMode });
  },
  applySequenceState,
  trigger, release: releaseAll,
  getStatus: () => ({ armed: audio.armed, playing, section: activeSection, sampleRate: audio.context?.sampleRate || null, heldNotes: held.size, voiceMode: state.voiceMode, voiceLimit: inputCategory === 'percussion' ? 24 : state.voiceMode === "poly" ? 8 : 1,
    tuningId: state.tuningId, tuningLabel: getTuning(state.tuningId).label,
    routing: currentSignalPath(),
    input: { ...audio.input.status(), selection: processingInput, source: processingSource(), loading: loadingInput,
      ...(inputCategory === 'percussion' ? { kind: 'percussion', label: 'Drums & percussion' } : {}),
      ...(isVoiceInput(inputCategory) ? { kind: inputCategory, label: inputCategory === "speech" ? "Speech synthesis" : "Singing synthesis", voice: voiceSource.status(), loading: voiceSource.busy } : {}) }, tempo: Number($("tempo").value), playbackMode: sequenceOwnsTransport() ? "sequence" : "auto", playStyle: playbackStyle(), noteGate: Number($("noteGate").value) / 100,
    sequence: { id: inputCategory === 'percussion' ? 'drum-grid' : sequenceState.id, selected: inputCategory === 'percussion' || hasSequence(), running: playing && sequenceOwnsTransport(), stepIndex: inputCategory === 'percussion' ? audio.getSequenceStatus()?.stepIndex : sequenceState.cursor, studyCount: SEQUENCE_STUDY_COUNT, transportBeat: audio.currentSequenceBeat(), audio: audio.getSequenceStatus() } }),
});
listen(window, "pagehide", event => {
  pendingHostDrums = [];
  releaseAll();
  clearTimeout(voiceRenderTimer); voiceSource.deactivate();
  audio.mute();
  paintAudio();
  if (event.persisted) audio.context?.suspend().catch(() => {});
  if (!event.persisted) {
    cancelAnimationFrame(frames); analysisResize.disconnect(); document.documentElement.style.removeProperty("--synthesis-analysis-inset"); listeners.abort(); controlFields.forEach(field => field?.destroy()); methodGestureEditor?.destroy();
    envelopeEditor.destroy(); frequencyField.destroy(); tempoField.destroy(); gateField.destroy();
    sequenceParameterFields.forEach(field => field.destroy?.());
    fullPresets?.destroy(); processorPanel?.destroy(); sequenceSurface?.destroy();
    voicePanel.destroy(); void voiceSource.destroy(); drumPanel.destroy();
    Object.values(mixFields).forEach(field => field.destroy()); chooseControls.forEach(picker => picker.destroy()); audio.dispose();
    delete window.MorphazoidSynthesis;
  }
});
function mountInstrumentPresets() {
  // One tour and one cursor across every unattended source. Local method menus
  // remain scoped, but choosing an input never replaces this top-level bank.
  if (fullPresets) return;
  fullPresets = registerHeaderPresets({
    id: "synthesis", presets: instrumentPresetsForInput(), host: $("performancePresetHost"),
    capture: currentPerformanceInput, apply: applyPreparedPerformance,
    randomize: randomizeInstrumentPreset,
  });
  fullPresets.refresh();
  const host = $("performancePresetHost");
  host.querySelector(".header-preset-next").id = "nextPerformancePreset";
  host.querySelector(".header-preset-random").id = "randomPerformance";
  const dice = host.querySelector(".header-preset-random");
  dice.title = "Randomize every musical setting"; dice.setAttribute("aria-label", dice.title);
}

listen($("presetSelect"), "change", () => {
  if ($("presetSelect").value === "custom") return;
  state = stateFromPreset(state.methodId, $("presetSelect").value, state);
  renderState(false, true);
});
listen($("nextPreset"), "click", () => {
  const method = getMethod(state.methodId);
  const current = method.presets.findIndex(preset => preset.id === (state.presetId === "custom" ? lastFactoryPreset.presetId : state.presetId));
  state = stateFromPreset(method.id, method.presets[(current + 1) % method.presets.length].id, state);
  renderState(false, true);
});

populateTuningSelect();
populateSequenceSelect();
populateSequencePresetSelect();
rebuildSequence({ route: false });
renderSection();
renderState();
mountInstrumentPresets();
for (const [id, label] of [["methodSelect", "Choose method"], ["presetSelect", "Choose synthesis preset"], ["sequenceSelect", "Choose arpeggiator or sequence"], ["sequencePresetSelect", "Choose arpeggiator settings preset"], ["tuningSelect", "Choose tuning and note map"], ["envelopePresetSelect", "Choose ADSR preset"], ["inputCategory", "Choose input"], ["processingSource", "Choose input material"], ["voiceMode", "Voicing"], ["spectrumMode", "Frequency display"]]) {
  chooseControls.set(id, enhanceChooseSelect($(id), { label: id === "presetSelect" && activeSection === "processing" ? "Choose processing preset" : label }));
}
paintSequenceMetadata();
paintSequenceParameterControls();
paintTuning();
paintEnvelopePreset();
paintAudio();
frames = requestAnimationFrame(animate);

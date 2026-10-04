import { SYNTHESIS_DATES } from "./chronology.js";
import { SEQUENCE_ERAS } from "./sequence-chronology.js";
import { SEQUENCE_STUDIES, SEQUENCE_STUDY_COUNT } from "./sequence-catalog.js";
import { compileSequence } from "./sequence-compiler.js";
import { createSequenceParameterValues, getSequenceParameterDefinitions } from "./sequence-parameters.js";
import { createChaoticSpectrum, updateChaoticSpectrum, drawChaoticSpectrum } from "../../families/chaotic/chaotic-synth-visuals.js";
import { registerHeaderPresets } from "../../site/header-presets.js";
import { SECTION_METHODS, SECTION_PRESETS, methodSection, captureSoundState, fullPresetId, randomizeAllState, randomizeMethodState } from "./presets.js";
import {
  SYNTHESAURUS_MASTER_PRESETS,
  SEQUENCE_SETTING_RECIPES,
  applyPerformanceSnapshot,
  applySequenceSettingsRecipe,
  capturePerformanceSnapshot,
  createSequenceSettingsPresets,
  instantiateMasterPreset,
  nextTuningId,
  randomizeMasterPerformance,
  randomSequenceId,
  randomizeSequenceSettings,
  randomTuningId,
} from "./performance-presets.js";
import { PROCESSING_SCHEMA } from "./processing-schema.js";
import { PROCESSING_INPUT_OPTIONS, getProcessingInput } from "./demo-sources.js";
import { enhanceChooseSelect } from "./choose.js";
import { COMPUTER_KEYBOARD_LAYOUTS } from "../../midi-manager.js";
import { getMethod, getPreset, createDefaultState, stateFromPreset, sanitizeState, formatParameter } from "./catalog.js";
import { SynthesisAudio } from "./audio.js";
import { mountAudioInputControl } from "../../audio-input-control.js";
import { createEnvelopeEditor } from "./envelope.js";
import {
  ENVELOPE_PRESETS,
  getEnvelopePreset,
  matchEnvelopePreset,
  nextEnvelopePreset,
  randomEnvelopePreset,
} from "./envelope-presets.js";
import { createParameterControl, createKnobControl } from "./controls.js";
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
  if (!raw || raw.length > 4096) return {};
  try {
    const value = JSON.parse(raw);
    return value && typeof value === "object" && !Array.isArray(value) ? value : {};
  } catch { return {}; }
};
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
let lastMasterPresetId = null;
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
let synthesisSourceName = "Built-in synthetic source";
let processingInput = "preset";
let inputIntent = 0;
let loadingInput = false;
let inputControl = null;
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
const audio = new SynthesisAudio(showError, paintInput);
audio.setSequenceStatusListener(status => { sequenceState.workletStatus = status; });

function showError(error) {
  $("audioError").hidden = false;
  $("audioError").textContent = error?.message || String(error);
  $("status").textContent = $("audioError").textContent;
}

function configuredAudioState() {
  const method = getMethod(state.methodId);
  return {
    ...state,
    source: method.kind === "processor" ? processingSource() : state.source,
    kind: method.kind || "synthesis",
    engineId: method.engineId,
    processorId: method.processorId,
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
  $("status").textContent = audio.armed ? "Audio enabled. Play or audition the demonstration." : "Audio is off.";
}

listen($("audioButton"), "click", async () => {
  if (arming) return;
  $("audioError").hidden = true;
  if (audio.armed) { inputIntent++; loadingInput = false; audio.mute(); paintAudio(); return; }
  arming = true;
  paintAudio();
  try {
    syncAudio(); await audio.start();
    audio.resumeNotes(Array.from(held.values()));
    void ensureProcessingInput();
  }
  catch (error) { audio.mute(); showError(error); }
  finally { arming = false; paintAudio(); }
});

function rememberSection() {
  const session = sectionSessions[activeSection];
  session.sound = captureSoundState(state);
  session.lastFactoryPreset = { ...lastFactoryPreset };
  if (fullPresets) session.hasPresetInteraction = fullPresets.hasPresetInteraction;
}

function syncPresetToolbar() {
  refreshMasterPresetSelection();
  if (!fullPresets) return;
  fullPresets.lastPresetId = fullPresetId(lastFactoryPreset.methodId, lastFactoryPreset.presetId);
  fullPresets.hasPresetInteraction = true;
  fullPresets.refresh();
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
  value: requestedSequence?.defaults.tempoBpm ?? 120, unit: "BPM", onInput: updateTempo });
const gateField = createKnobControl({ id: "noteGate", label: "Note length", min: 5, max: 95, step: 1,
  value: 65, unit: "%", onInput: updateGate });
$("tempoControl").append(tempoField); $("gateControl").append(gateField);
let sequenceParameterFields = [];
const mixFields = {};
for (const [id, host, key, label, min, max, factor, unit] of [
  ["dryWet", "wetControl", "wet", "Wet", 0, 100, .01, "%"],
  ["inputGain", "inputGainControl", "inputDb", "Input gain", -36, 24, 1, "dB"],
  ["effectGain", "effectGainControl", "outputDb", "Effect output", -36, 24, 1, "dB"],
]) {
  const field = createKnobControl({ id, label, min, max, step: factor === .01 ? 1 : .5, unit,
    value: (state[key] ?? (key === "wet" ? 1 : 0)) / factor,
    onInput: value => { state[key] = value * factor; markCustom(); } });
  $(host).append(field); mixFields[key] = field;
}

const envelopeEditor = createEnvelopeEditor($("envelopeControls"), {
  onChange(envelope) { state.envelope = envelope; markCustom(); paintEnvelopePreset(); },
});

function paintEnvelopePreset() {
  const matched = matchEnvelopePreset(state.envelope);
  const options = ENVELOPE_PRESETS.map(preset => new Option(preset.label, preset.id));
  if (!matched) options.unshift(new Option("Custom envelope", "custom"));
  $("envelopePresetSelect").replaceChildren(...options);
  $("envelopePresetSelect").value = matched?.id || "custom";
  $("envelopePresetDescription").textContent = matched?.description
    || "Custom four-stage envelope from the current sound preset or manual edits.";
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
const sequenceOwnsTransport = () => activeSection === "synthesis" && hasSequence();
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
  rebuildSequence();
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
    root.destroy = () => { input.removeEventListener("change", change); root.remove(); };
    return root;
  }
  const percent = definition.unit === "%" && definition.max <= 2;
  const factor = percent ? 100 : 1;
  const field = createKnobControl({
    id, label: definition.label,
    min: definition.min * factor, max: definition.max * factor,
    step: definition.step * factor, unit: definition.unit,
    value: value * factor,
    onInput: next => updateSequenceParameter(definition.id, next / factor),
  });
  field.classList.add("synthesis-parameter");
  field.title = definition.help;
  return field;
}

function paintSequenceParameterControls() {
  sequenceParameterFields.forEach(field => field.destroy?.());
  sequenceParameterFields = [];
  const host = $("sequenceParameterControls");
  const study = sequenceStudy();
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
  const definitions = getSequenceParameterDefinitions(study).filter(definition => definition.id !== "gate");
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
  const note = document.createElement("p");
  note.className = "synthesis-sequence-parameter-note";
  note.textContent = `These controls define this preset’s ${mechanismName.toLowerCase()} shape.`;
  const mechanism = definitions.filter(definition => definition.group === "mechanism");
  mechanismSection.append(heading, note, buildGrid(mechanism, "synthesis-sequence-parameter-grid--mechanism"));

  const cycleDetails = document.createElement("details");
  cycleDetails.className = "synthesis-sequence-cycle-details";
  const summary = document.createElement("summary");
  summary.textContent = "Cycle, chance & pitch mapping";
  const cycle = definitions.filter(definition => definition.group === "cycle");
  cycleDetails.append(summary, buildGrid(cycle, "synthesis-sequence-parameter-grid--cycle"));
  host.replaceChildren(mechanismSection, cycleDetails);
  refreshSequencePresetSelection();
}

function populateTuningSelect() {
  const groups = new Map();
  for (const tuning of TUNINGS) {
    if (!groups.has(tuning.group)) {
      const group = document.createElement("optgroup");
      group.label = tuning.group;
      groups.set(tuning.group, group);
    }
    groups.get(tuning.group).append(new Option(tuning.label, tuning.id));
  }
  $("tuningSelect").replaceChildren(...groups.values());
  $("tuningSelect").value = state.tuningId;
}

function paintTuning() {
  const tuning = getTuning(state.tuningId);
  const period = Math.abs(tuning.periodRatio - 2) < 1e-9 ? "octave"
    : Math.abs(tuning.periodRatio - 3) < 1e-9 ? "tritave" : `${Number(tuning.periodRatio.toFixed(4))}:1 period`;
  const evidence = String(tuning.evidence || tuning.kind).replaceAll("-", " ");
  const processing = getMethod(state.methodId).kind === "processor";
  $("tuningSummary").textContent = `${tuning.degreeCents.length} notes · ${period} · ${evidence}. ${tuning.caveat || tuning.description}${processing ? " Used by synthesis notes when you return to Synth." : ""}`;
  $("tuningSummary").title = `${tuning.description} Source: ${tuning.source?.label || "tuning catalogue"}`;
  $("tuningDescription").textContent = tuning.description;
  $("tuningCaveat").textContent = tuning.caveat || "This tuning is used as a playable note map.";
  $("tuningReference").textContent = tuning.source?.label || "Tuning catalogue notes";
  $("tuningReference").href = tuning.source?.url || "docs/synthesaurus-tunings.md";
  $("tuningReference").target = tuning.source?.url ? "_blank" : "";
  $("tuningReference").rel = tuning.source?.url ? "noreferrer" : "";
}

function populateSequenceSelect() {
  const direct = new Option("Direct note · current Play behavior", "none");
  const groups = [];
  for (const era of SEQUENCE_ERAS) {
    const group = document.createElement("optgroup");
    group.label = `${era.range} · ${era.label}`;
    for (const study of SEQUENCE_STUDIES.filter(entry => entry.eraId === era.id).sort((a, b) => a.placementYear - b.placementYear || a.label.localeCompare(b.label))) {
      group.append(new Option(`${study.label} · ${study.dateLabel}`, study.id));
    }
    groups.push(group);
  }
  const basics = document.createElement("optgroup");
  basics.label = "Quick tuning arpeggios";
  for (const item of BASIC_SEQUENCES) basics.append(new Option(item.label, item.id));
  groups.push(basics);
  $("sequenceSelect").replaceChildren(direct, ...groups);
  $("sequenceSelect").value = sequenceState.id;
  $("sequenceCount").textContent = `${SEQUENCE_STUDY_COUNT} editable studies · search or scroll · ${BASIC_SEQUENCES.length} quick patterns`;
}

function populatePerformancePresetSelects() {
  $("masterPresetSelect").replaceChildren(
    new Option("Choose a complete scene…", "custom"),
    ...SYNTHESAURUS_MASTER_PRESETS.map(preset => new Option(preset.label, preset.id)),
  );
  $("sequencePresetSelect").replaceChildren(
    new Option("Custom settings", "custom"),
    ...SEQUENCE_SETTING_RECIPES.map(recipe => new Option(recipe.label, recipe.id)),
  );
}

function currentPerformanceSnapshot() {
  const study = sequenceStudy();
  if (!study || activeSection !== "synthesis") return null;
  return capturePerformanceSnapshot({
    sound: state,
    tuningId: state.tuningId,
    sequence: { id: study.id, parameters: sequenceState.parameters, tempoBpm: Number($("tempo").value) },
  });
}

function refreshMasterPresetSelection() {
  const select = $("masterPresetSelect");
  if (!select) return;
  const snapshot = currentPerformanceSnapshot();
  const key = snapshot ? JSON.stringify(snapshot) : null;
  const matching = key ? SYNTHESAURUS_MASTER_PRESETS.find(preset => JSON.stringify(preset.snapshot) === key) : null;
  select.value = matching?.id || "custom";
  if (matching) lastMasterPresetId = matching.id;
  chooseControls.get("masterPresetSelect")?.refresh();
}

function refreshSequencePresetSelection() {
  const study = sequenceStudy();
  const section = $("sequencePresetSection");
  section.hidden = !study;
  if (!study) return;
  const tempo = Number($("tempo").value);
  const parameters = JSON.stringify(sequenceState.parameters);
  const matching = createSequenceSettingsPresets(study).find(preset => (
    preset.snapshot.tempoBpm === tempo && JSON.stringify(preset.snapshot.parameters) === parameters
  ));
  $("sequencePresetSelect").value = matching?.id.split(":").at(-1) || "custom";
  chooseControls.get("sequencePresetSelect")?.refresh();
}

function paintSequenceMetadata() {
  const study = sequenceStudy();
  const basic = selectedBasicSequence();
  const active = !!study || !!basic;
  $("sequenceSelect").value = study?.id || basic?.id || "none";
  $("sequenceControls").hidden = !active;
  $("sequenceStrip").hidden = !active;
  $("sequenceShapeSummary").hidden = !active;
  $("sequenceParameterSummary").textContent = study
    ? `${study.kind} · ${study.archetype.replaceAll("-", " ")}`
    : basic ? `${basic.label} · selected tuning` : "Direct performance";
  if (!active) {
    $("sequenceCue").textContent = "Choose an original study to test the current synth with a historically grounded sequencing mechanism.";
    $("sequenceMilestone").textContent = "Direct performance";
    $("sequenceMilestone").removeAttribute("title");
    $("sequenceKind").textContent = "Held or repeated note";
    $("sequenceTestFocus").textContent = "The current preset without an added pitch pattern";
    $("sequenceLineage").textContent = "Direct mode keeps Synthesaurus’s existing sustained or pulse-note demonstration.";
    $("sequenceLimitations").textContent = "Sequence studies are newly authored demonstrations of general mechanisms, not copied factory phrases or exact hardware emulations.";
    const reference = document.createElement("a");
    reference.id = "sequenceReference";
    reference.textContent = "Sequence history and sources";
    reference.href = "docs/synthesis-sequences.md";
    $("sequenceReferences").replaceChildren(reference);
    chooseControls.get("sequenceSelect")?.refresh();
    return;
  }
  if (basic) {
    $("sequenceCue").textContent = `${basic.label} follows the chord degrees authored for ${getTuning(state.tuningId).label}.`;
    $("sequenceMilestone").textContent = "Basic tuning-aware arpeggio";
    $("sequenceMilestone").removeAttribute("title");
    $("sequenceKind").textContent = "arpeggiator · ordered tuning chord";
    $("sequenceTestFocus").textContent = "Tuning translation · envelope response · polyphony";
    $("sequenceLineage").textContent = "A compact traversal retained from the original tuning implementation; choose any historical study above for a richer mechanism.";
    $("sequenceLimitations").textContent = "Chord degrees follow each tuning catalogue entry and are an audition voicing, not a claim about a tradition’s harmony.";
    const reference = document.createElement("a");
    reference.id = "sequenceReference";
    reference.textContent = "Tuning sources and limits";
    reference.href = "docs/synthesaurus-tunings.md";
    $("sequenceReferences").replaceChildren(reference);
    chooseControls.get("sequenceSelect")?.refresh();
    return;
  }
  $("sequenceCue").textContent = study.cue;
  $("sequenceMilestone").textContent = `${study.dateLabel} · ${study.dateKind}`;
  $("sequenceMilestone").title = study.dateNote;
  $("sequenceKind").textContent = `${study.kind} · ${study.archetype.replaceAll("-", " ")}`;
  $("sequenceTestFocus").textContent = study.testFocus.join(" · ");
  $("sequenceLineage").textContent = study.lineage;
  const sources = study.provenance.sources;
  $("sequenceLimitations").textContent = [study.limitations, ...sources.map(source => source.limitation)].filter(Boolean).join(" ");
  const references = document.createDocumentFragment();
  sources.forEach((source, index) => {
    if (index) references.append(document.createTextNode(" · "));
    const reference = document.createElement("a");
    if (index === 0) reference.id = "sequenceReference";
    reference.textContent = source.label;
    reference.href = source.url;
    reference.target = "_blank";
    reference.rel = "noreferrer";
    references.append(reference);
  });
  $("sequenceReferences").replaceChildren(references);
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
  const steps = cycle.steps.map(step => ({
    ...step,
    notes: step.notes.flatMap(note => {
      let ratio = Number.isSafeInteger(note.degree)
        ? tuningRatioForDegree(note.degree, state.tuningId)
        : tuningRatioForSemitoneCoordinate(note.semitone, state.tuningId, sequenceState.pitchMode);
      if (basic && Number.isFinite(ratio)) ratio = fitBasicRatio(ratio, rootFrequency);
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
  sequenceState.rootFrequency = state.frequencyHz;
  audio.setSequenceRootFrequency(state.frequencyHz);
  return true;
}

function rebuildSequence({ restart = false, route = true, audioState = null } = {}) {
  const cycle = compileSelectedSequence();
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
  refreshMasterPresetSelection();
  if (route) updateUrl();
}

function updateTempo() {
  const tempo = Number($("tempo").value);
  if (sequenceOwnsTransport()) audio.setSequenceTempo(tempo);
  else audio.setPlaying(playing, tempo / 60, Number($("noteGate").value) / 100);
  refreshSequencePresetSelection();
  refreshMasterPresetSelection();
}

function updateGate() {
  if (selectedBasicSequence()) rebuildSequence();
  else if (sequenceStudy()) return;
  else audio.setPlaying(playing, Number($("tempo").value) / 60, Number($("noteGate").value) / 100);
}

function syncTransportForSection({ restartSequence = false } = {}) {
  const tempo = Number($("tempo").value), gate = Number($("noteGate").value) / 100;
  if (activeSection === "processing") {
    audio.stopSequence();
    audio.setPlaying(playing, tempo / 60, gate);
    return;
  }
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
    params.set("sequenceDensity", String(Number(sequenceState.density.toFixed(2))));
    params.set("sequenceSwing", String(Number(sequenceState.swing.toFixed(2))));
    params.set("sequenceSeed", String(sequenceState.seed));
    params.set("sequencePitch", sequenceState.pitchMode);
    if (sequenceStudy() && sequenceState.parameters) params.set("sequenceParams", JSON.stringify(sequenceState.parameters));
    else params.delete("sequenceParams");
  } else {
    for (const key of ["sequence", "sequenceDensity", "sequenceSwing", "sequenceSeed", "sequencePitch", "sequenceParams"]) params.delete(key);
  }
  history.replaceState(null, "", `${location.pathname}?${params}${location.hash}`);
}

function renderState(rebuildControls = true, audition = false, restoringSection = false) {
  const method = getMethod(state.methodId);
  const sectionChanged = activeSection !== methodSection(method.id);
  if (sectionChanged) {
    chooseControls.forEach(picker => { picker.details.open = false; });
    fullPresets?.destroy();
    fullPresets = null;
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
  $("methodNotes").textContent = method.lineage;
  const milestone = SYNTHESIS_DATES[method.id];
  $("methodDate").textContent = `${milestone.dateLabel} · ${milestone.dateKind}`;
  $("methodDate").title = milestone.dateNote;
  $("methodDateNote").textContent = milestone.dateNote;
  $("methodDateReference").textContent = milestone.dateSource.label;
  $("methodDateReference").href = milestone.dateSource.url;
  $("modelNote").textContent = [method.depth, ...(Array.isArray(method.limitations) ? method.limitations : [method.limitations])].filter(Boolean).join(" ");
  $("methodReference").textContent = method.citation.label;
  $("methodReference").href = method.citation.url;
  const processing = method.kind === "processor";
  if (processing && held.size) releaseAll();
  $("masterPresetRow").hidden = processing;
  $("sequenceCompendium").hidden = processing;
  $("sequenceSelect").disabled = processing;
  $("nextSequence").disabled = processing;
  $("randomSequence").disabled = processing;
  if (processing) chooseControls.get("sequenceSelect")?.details && (chooseControls.get("sequenceSelect").details.open = false);
  $("nextMethod").title = processing ? "Next processor" : "Next synthesis method";
  $("nextMethod").setAttribute("aria-label", $("nextMethod").title);
  $("randomMethodType").title = processing ? "Random processor" : "Random synthesis method";
  $("randomMethodType").setAttribute("aria-label", $("randomMethodType").title);
  $("randomMethodLabel").textContent = processing ? "Random effect" : "Random synth";
  $("synthParameterHeading").textContent = processing ? "Processor parameters" : "Synth parameters";
  $("randomMethod").title = "Randomize settings for " + method.label + " only";
  $("randomMethod").setAttribute("aria-label", $("randomMethod").title);
  $("noteTiming").hidden = processing;
  $("soundControls").setAttribute("aria-label", processing ? "Processing controls" : "Synthesis controls");
  $("processingControls").hidden = !processing;
  if (processing) document.querySelector(".synthesis-play-row").after($("processingControls"), $("sourceControls"), $("frequencyRow"));
  else { $("noteTiming").prepend($("frequencyRow")); $("methodControls").after($("sourceControls")); }
  $("envelopeDetails").hidden = processing;
  $("keyboardDetails").hidden = processing;
  $("voiceModeControl").hidden = processing;
  $("voiceMode").value = state.voiceMode;
  $("tuningSelect").value = state.tuningId;
  paintTuning();
  paintVoicing();
  mixFields.wet.setValue((state.wet ?? 1) * 100);
  mixFields.inputDb.setValue(state.inputDb ?? 0);
  mixFields.outputDb.setValue(state.outputDb ?? 0);
  $("processingBypass").checked = state.bypass === true;
  $("restoreSource").hidden = processing;
  if (renderState.lastMethod && renderState.lastMethod !== method.id) {
    if (!processing || audio.input.pending || audio.captureRequest) { inputIntent++; loadingInput = false; audio.stopInput(); }
  }
  if (processing && processingSource() !== 0 && (audio.input.kind !== "none" || loadingInput)) {
    inputIntent++; loadingInput = false; audio.stopInput();
  }
  renderState.lastMethod = method.id;
  paintInput();
  renderTeaching(method);
  $("playButton").setAttribute("aria-label", playing ? "Pause" : "Play");
  $("playButton").setAttribute("aria-pressed", String(playing));
  paintPlayback();
  $("sourceControls").hidden = !method.sourceInput && !processing;
  $("outputLevel").value = state.outputLevel;
  $("outputLevelOut").value = `${Math.round(state.outputLevel * 100)}%`;
  frequencyField.setValue(state.frequencyHz);
  envelopeEditor.setValue(state.envelope);
  paintEnvelopePreset();
  if (rebuildControls) {
    controlFields.forEach(field => field.destroy());
    controlFields = method.controls.map((control, index) => createParameterControl(
      control, index, state.params[index], value => { state.params[index] = value; markCustom(); },
    ));
    $("methodControls").replaceChildren(...controlFields);
  } else controlFields.forEach((field, index) => field.setValue(state.params[index]));
  chooseControls.forEach(picker => picker.refresh());
  if (!deferAudioSync) syncAudio(audition);
  if (!deferTransportSync) queueMicrotask(() => syncTransportForSection());
  if (processing) void ensureProcessingInput({ audition });
  updateUrl();
  rememberSection();
  if (sectionChanged) mountSectionPresets();
}

function renderSection() {
  const processing = activeSection === "processing";
  const name = processing ? "Processing" : "Synthesis";
  $("synthesis").dataset.section = activeSection;
  for (const button of document.querySelectorAll(".synthesis-sections button")) button.setAttribute("aria-pressed", String(button.dataset.section === activeSection));
  $("methodLabel").textContent = processing ? "Processor" : "Synthesis method";
  $("presetSectionLabel").textContent = name + " presets";
  const methods = SECTION_METHODS[activeSection];
  const groups = new Map();
  for (const method of methods) {
    if (!groups.has(method.group)) {
      const group = document.createElement("optgroup"); group.label = method.group; groups.set(method.group, group);
    }
    groups.get(method.group).append(new Option(`${method.label} · ${SYNTHESIS_DATES[method.id].dateLabel}`, method.id));
  }
  $("methodSelect").replaceChildren(...groups.values());
}

function switchSection(section) {
  if (section === activeSection || !sectionSessions[section]) return;
  rememberSection();
  state = sanitizeState({ ...sectionSessions[section].sound, outputLevel: state.outputLevel,
    voiceMode: state.voiceMode, tuningId: state.tuningId });
  renderState(true, true, true);
}
for (const button of document.querySelectorAll("button[data-section]")) listen(button, "click", () => switchSection(button.dataset.section));

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
  refreshMasterPresetSelection();
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

function randomOtherChoice(select) {
  const options = [...select.options].filter(option => !option.disabled && !option.hidden && option.value !== select.value);
  if (!options.length) return select.value;
  return options[Math.min(options.length - 1, Math.floor(Math.max(0, Math.min(1, Math.random())) * options.length))].value;
}

function applyPreparedPerformance(performance, { presetId = null, message = "Performance loaded." } = {}) {
  const prepared = applyPerformanceSnapshot(performance, state);
  const study = SEQUENCE_STUDIES.find(candidate => candidate.id === prepared.sequence.id);
  if (!study) throw new RangeError(`Unknown master-scene sequence: ${prepared.sequence.id}`);
  const previousMethod = state.methodId;
  state = sanitizeState(prepared.sound);
  lastFactoryPreset = { methodId: state.methodId, presetId: state.presetId };
  sequenceState.id = study.id;
  sequenceState.workletStatus = null;
  syncSequenceParameterState(createSequenceParameterValues(study, prepared.sequence.parameters));
  tempoField.setValue(prepared.sequence.tempoBpm);
  $("sequenceSelect").value = study.id;
  lastMasterPresetId = presetId;
  const atomicSequenceChange = playing && activeSection === "synthesis";
  deferTransportSync = true;
  deferAudioSync = atomicSequenceChange;
  try { renderState(state.methodId !== previousMethod, false); }
  finally { deferTransportSync = false; deferAudioSync = false; }
  chooseControls.get("sequenceSelect")?.refresh();
  paintSequenceParameterControls();
  const nextAudioState = atomicSequenceChange ? configuredAudioState() : null;
  // A running scene changes sound and score together on one worklet boundary.
  // An active gate is handed across; a silent phase launches the first authored attack.
  queueMicrotask(() => {
    rebuildSequence({ restart: playing, audioState: nextAudioState });
    refreshMasterPresetSelection();
  });
  $("status").textContent = message;
}

function currentPerformanceInput() {
  const study = sequenceStudy() || SEQUENCE_STUDIES[0];
  return {
    sound: state,
    tuningId: state.tuningId,
    sequence: {
      id: study.id,
      parameters: sequenceState.parameters ?? createSequenceParameterValues(study),
      tempoBpm: Number($("tempo").value),
    },
  };
}

listen($("masterPresetSelect"), "change", () => {
  const id = $("masterPresetSelect").value;
  if (id === "custom") return;
  try {
    const preset = SYNTHESAURUS_MASTER_PRESETS.find(candidate => candidate.id === id);
    applyPreparedPerformance(instantiateMasterPreset(id, state), {
      presetId: id,
      message: `${preset?.label || "Master scene"} loaded without stopping the transport.`,
    });
  } catch (error) { showError(error); refreshMasterPresetSelection(); }
});

listen($("nextMasterPreset"), "click", () => {
  const currentId = $("masterPresetSelect").value !== "custom" ? $("masterPresetSelect").value : lastMasterPresetId;
  const current = SYNTHESAURUS_MASTER_PRESETS.findIndex(preset => preset.id === currentId);
  dispatchChoice($("masterPresetSelect"), SYNTHESAURUS_MASTER_PRESETS[(current + 1) % SYNTHESAURUS_MASTER_PRESETS.length].id);
});

listen($("randomMasterPreset"), "click", () => {
  try {
    applyPreparedPerformance(randomizeMasterPerformance(currentPerformanceInput()), {
      message: "Synth, arpeggiator settings, and tuning randomized as one complete scene.",
    });
  } catch (error) { showError(error); }
});

listen($("sequencePresetSelect"), "change", () => {
  const study = sequenceStudy();
  const recipe = $("sequencePresetSelect").value;
  if (!study || recipe === "custom") return;
  const next = applySequenceSettingsRecipe({
    id: study.id, parameters: sequenceState.parameters, tempoBpm: Number($("tempo").value),
  }, recipe);
  selectSequence(study.id, { parameters: next.parameters, tempo: next.tempoBpm, restart: playing, announce: false });
  $("status").textContent = `${SEQUENCE_SETTING_RECIPES.find(item => item.id === recipe)?.label || "Settings"} arpeggiator settings loaded without changing the synth or tuning.`;
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
listen($("randomMethodType"), "click", () => dispatchChoice($("methodSelect"), randomOtherChoice($("methodSelect"))));
listen($("nextSequence"), "click", () => dispatchChoice($("sequenceSelect"), adjacentChoice($("sequenceSelect"))));
listen($("randomSequence"), "click", () => {
  const id = randomSequenceId();
  const next = randomizeSequenceSettings({ id });
  selectSequence(id, { parameters: next.parameters, tempo: next.tempoBpm, restart: playing });
});
listen($("nextTuning"), "click", () => dispatchChoice($("tuningSelect"), nextTuningId(state.tuningId)));
listen($("randomTuning"), "click", () => dispatchChoice($("tuningSelect"), randomTuningId()));

listen($("envelopePresetSelect"), "change", () => {
  if ($("envelopePresetSelect").value !== "custom") applyEnvelopePreset($("envelopePresetSelect").value);
});
listen($("nextEnvelopePreset"), "click", () => {
  const current = matchEnvelopePreset(state.envelope);
  applyEnvelopePreset(nextEnvelopePreset(current?.id || "custom"));
});
listen($("randomEnvelopePreset"), "click", () => {
  const current = matchEnvelopePreset(state.envelope);
  applyEnvelopePreset(randomEnvelopePreset(Math.random, { excludeId: current?.id || null }));
});

listen($("randomMethod"), "click", () => {
  state = randomizeMethodState(state);
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
  $("playButton").title = style === "process" ? `${action} processing demo` : style === "sequence" ? `${action} selected sequence` : repeats ? `${action} demo · pulse notes at the selected tempo` : `${action} demo · hold a continuous note`;
  $("tempoControl").title = $("gateControl").title = style === "sequence" ? "The selected sequence uses this tempo and note length" : repeats ? "Demo notes pulse at this tempo and note length" : "Tempo and note length apply to percussive or zero-sustain sounds";
  $("gateControl").hidden = !!sequenceStudy();
  tempoField.setDisabled(!repeats);
  gateField.setDisabled(!repeats || !!sequenceStudy());
}
function setPlaying(value) {
  playing = !!value;
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
  if (processing && ["demo", "file"].includes(selectedInput()?.kind)) {
    void ensureProcessingInput({ audition: true, restart: true });
    return;
  }
  const poly = state.voiceMode === "poly" && !processing;
  const duration = Math.min(24.2, state.envelope.attack + state.envelope.decay + 0.18);
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
  $("triggerButton").textContent = processing ? "Audition · 3 s" : state.voiceMode === "poly" ? "Trigger Notes (poly)" : "Trigger Note";
  $("triggerButton").title = processing ? "Audition the selected input for three seconds" : state.voiceMode === "poly" ? "Play a three-note chord from the selected tuning and note map" : "Play one note at the selected frequency";
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
  if (source === "wax" && getMethod(state.methodId).kind === "processor") return;
  const id = `midi:${message.sourceId || "default"}:${message.channel || 0}:${message.note}`;
  if (message.type === "noteOn" && Number(message.velocity) > 0) {
    event.preventDefault();
    press(id, frequencyForMidiNote(message.note, state.tuningId,
      { anchorNote: 69, anchorHz: 440, minHz: 20, maxHz: 8000 }), message.velocity / 127);
    if (source === "wax" && !audio.armed && !arming) $("audioButton").click();
  }
  else if (message.type === "noteOff" || message.type === "noteOn" && Number(message.velocity) <= 0) { event.preventDefault(); release(id); }
  else if (message.type === "panic" || (message.type === "controlChange" && [120, 123].includes(message.controller))) { event.preventDefault(); releaseAll(); setPlaying(false); audio.panic(); }
});
function processingSource() {
  return processingInput === "preset" ? (state.source ?? 0) : (getProcessingInput(processingInput)?.source ?? 0);
}
function selectedInput() { return getProcessingInput(processingInput); }
function paintInput() {
  const status = audio.input.status();
  const processing = getMethod(state.methodId).kind === "processor";
  const option = selectedInput();
  const external = processing && processingSource() === 0;
  const loopable = processing && ["demo", "file"].includes(option?.kind);
  $("processingLoopControl").hidden = !loopable;
  $("processingLoop").checked = status.loop;
  const microphone = external && (option?.kind === "microphone" || processingInput === "preset");
  $("frequencyRow").hidden = processing && processingSource() === 0;
  frequencyField.labelElement.textContent = processing ? "Signal pitch" : "Frequency";
  $("sourceName").hidden = processing;
  $("sourceName").textContent = synthesisSourceName;
  $("processingSource").value = processingInput;
  const presetOption = $("processingSource").options[0];
  if (presetOption) {
    const text = "Preset input · " + (PROCESSING_SCHEMA.sources[state.source ?? 0] ?? "Signal");
    if (presetOption.text !== text) presetOption.text = text;
  }
  chooseControls.get("processingSource")?.refresh();
  $("processingInputHint").textContent = processingInput === "preset"
    ? "The preset chooses its demonstration signal. Choose another input to keep it while exploring effects."
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
const inputGroups = new Map();
for (const option of PROCESSING_INPUT_OPTIONS) {
  if (!inputGroups.has(option.group)) { const group = document.createElement("optgroup"); group.label = option.group; inputGroups.set(option.group, group); }
  inputGroups.get(option.group).append(new Option(option.label, option.id));
}
$("processingSource").replaceChildren(new Option("Preset input", "preset"), ...inputGroups.values());
async function ensureProcessingInput({ audition = false, connectMic = false, restart = false } = {}) {
  if (!audio.armed || getMethod(state.methodId).kind !== "processor") { paintInput(); return; }
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
});
listen($("processingSource"), "change", () => {
  processingInput = $("processingSource").value;
  inputIntent++; loadingInput = false; audio.stopInput();
  paintInput(); syncAudio(processingSource() !== 0);
  void ensureProcessingInput({ audition: true });
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
listen($("processingBypass"), "change", () => { state.bypass = $("processingBypass").checked; markCustom(); });
async function connectInput() {
  inputError = "";
  const methodId = state.methodId;
  const intent = inputIntent;
  try {
    await audio.start({ arm: false });
    if (intent !== inputIntent) return;
    if (inputControl.root.sourceSelect.value === "file") {
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
  container: $("sourceControls"), before: $("sourceFileLabel"),
  button: $("startMicrophone"), gainInput: mixFields.inputDb.input, gainOutput: mixFields.inputDb.output,
  gainFormat: value => `${value > 0 ? "+" : ""}${value} dB`,
  gainMultiplier: () => 10 ** ((state.inputDb ?? 0) / 20),
  sources: [{ value: "mic", label: "Mic" }, { value: "file", label: "File" }], fileInput: $("sourceFile"),
  getState: () => ({ active: audio.input.kind !== "none", pending: audio.input.pending || loadingInput, error: inputError,
    supported: Boolean(getMethod(state.methodId).sourceInput || getMethod(state.methodId).kind === "processor"),
    source: audio.input.kind === "file" || processingInput === "file" ? "file" : "mic" }),
  getSignal: () => ({ node: audio.input.node, stream: audio.input.stream,
    channels: audio.input.kind === "file" ? audio.input.fileBuffer?.numberOfChannels : undefined }),
  onStart: connectInput,
  onStop: () => { inputIntent++; loadingInput = false; inputError = ""; audio.stopInput(); paintInput(); },
  onSourceChange: value => {
    inputError = "";
    inputIntent++; loadingInput = false; audio.stopInput();
    processingInput = value === "file" ? "file" : "microphone";
    paintInput(); syncAudio();
  },
  hide: [$("sourceFileLabel"), $("stopInput"), $("resumeFile"), $("inputStatus"), $("inputLevel"), $("inputHelp"), $("inputGainControl")],
});

function selectedTouchstone() {
  return (getMethod(state.methodId).touchstones || []).find(item => item.id === $("touchstoneSelect").value);
}
function paintTouchstone() {
  const item = selectedTouchstone();
  $("touchstoneListen").textContent = item?.listenFor || item?.expected || "";
  $("touchstoneGesture").textContent = item?.gesture || item?.action || "";
  const actions = [];
  for (const gesture of item?.parameterGestures || []) {
    const index = gesture.controlIndex;
    const control = getMethod(state.methodId).controls[index];
    if (!control) continue;
    const values = gesture.normalizedValues || [gesture.fromNormalized, gesture.toNormalized];
    for (const value of values.filter(Number.isFinite)) {
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = `${control.label}: ${formatParameter(control, value)}`;
      button.addEventListener("click", () => {
        state.params[index] = value;
        state.presetId = "custom";
        renderState(false, !playing);
      });
      actions.push(button);
    }
  }
  $("touchstoneActions").replaceChildren(...actions);
}
function renderTeaching(method) {
  const previous = $("touchstoneSelect").value;
  const items = method.touchstones || [];
  $("touchstoneSelect").replaceChildren(...items.map(item => new Option(item.title, item.id)));
  if (items.some(item => item.id === previous)) $("touchstoneSelect").value = previous;
  $("teachingDetails").hidden = !items.length;
  paintTouchstone();
}
listen($("touchstoneSelect"), "change", paintTouchstone);
listen($("loadTouchstone"), "click", () => {
  const item = selectedTouchstone();
  if (!item) return;
  state = stateFromPreset(state.methodId, item.presetId, state);
  lastFactoryPreset = { methodId: state.methodId, presetId: state.presetId };
  const before = JSON.stringify([state.params, state.frequencyHz]);
  if (Number.isFinite(item.frequencyHz)) state.frequencyHz = item.frequencyHz;
  for (const gesture of item.parameterGestures || []) {
    const value = gesture.normalizedValues?.[0] ?? gesture.fromNormalized;
    if (Number.isFinite(value)) state.params[gesture.controlIndex] = value;
  }
  if (before !== JSON.stringify([state.params, state.frequencyHz])) state.presetId = "custom";
  renderState(false, true);
});

const scope = $("scope"), spectrum = $("spectrum");
const scopeContext = scope.getContext("2d", { alpha: false });
const spectrumContext = spectrum.getContext("2d", { alpha: false });
// Keep history independent of canvas size so rotation and Freeze retain it.
const historyCanvas = document.createElement("canvas");
historyCanvas.width = 240; historyCanvas.height = 160;
const historyContext = historyCanvas.getContext("2d", { alpha: false });
background(historyContext, historyCanvas.width, historyCanvas.height);
const analysisResize = new ResizeObserver(() => {
  const dock = $("soundAnalysis");
  const height = getComputedStyle(dock).position === "fixed" ? dock.getBoundingClientRect().height : 0;
  document.documentElement.style.setProperty("--synthesis-analysis-inset", height + "px");
  analysisDirty = true;
});
analysisResize.observe($("soundAnalysis"));
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
  getState: () => structuredClone(state),
  getSequenceState: () => structuredClone({ version: 1, id: sequenceState.id, density: sequenceState.density,
    swing: sequenceState.swing, seed: sequenceState.seed, pitchMode: sequenceState.pitchMode,
    parameters: sequenceState.parameters, cycle: sequenceState.cycle }),
  applyState(value) {
    state = sanitizeState(value);
    renderState();
    if (value?.arpMode) applySequenceState({ arpMode: value.arpMode });
  },
  applySequenceState,
  trigger, release: releaseAll,
  getStatus: () => ({ armed: audio.armed, playing, section: activeSection, sampleRate: audio.context?.sampleRate || null, heldNotes: held.size, voiceMode: state.voiceMode, voiceLimit: state.voiceMode === "poly" ? 8 : 1,
    tuningId: state.tuningId, tuningLabel: getTuning(state.tuningId).label,
    input: { ...audio.input.status(), selection: processingInput, source: processingSource(), loading: loadingInput }, tempo: Number($("tempo").value), playbackMode: hasSequence() ? "sequence" : "auto", playStyle: playbackStyle(), noteGate: Number($("noteGate").value) / 100,
    sequence: { id: sequenceState.id, selected: hasSequence(), running: playing && sequenceOwnsTransport(), stepIndex: sequenceState.cursor, studyCount: SEQUENCE_STUDY_COUNT, transportBeat: audio.currentSequenceBeat(), audio: audio.getSequenceStatus() } }),
});
listen(window, "pagehide", event => {
  releaseAll();
  audio.mute();
  paintAudio();
  if (event.persisted) audio.context?.suspend().catch(() => {});
  if (!event.persisted) {
    cancelAnimationFrame(frames); analysisResize.disconnect(); document.documentElement.style.removeProperty("--synthesis-analysis-inset"); listeners.abort(); controlFields.forEach(field => field.destroy());
    envelopeEditor.destroy(); frequencyField.destroy(); tempoField.destroy(); gateField.destroy();
    sequenceParameterFields.forEach(field => field.destroy?.());
    Object.values(mixFields).forEach(field => field.destroy()); chooseControls.forEach(picker => picker.destroy()); audio.dispose();
    delete window.MorphazoidSynthesis;
  }
});
function mountSectionPresets() {
  const section = activeSection;
  const session = sectionSessions[section];
  fullPresets = registerHeaderPresets({
    id: "synthesis",
    presets: SECTION_PRESETS[section],
    host: $("presetHost"),
    capture: () => captureSoundState(state),
    apply(sound) {
      const previousMethod = state.methodId;
      state = sanitizeState({ ...sound, outputLevel: state.outputLevel,
        voiceMode: state.voiceMode, tuningId: state.tuningId });
      renderState(state.methodId !== previousMethod, true);
    },
    randomize: (sound, rng) => captureSoundState(randomizeAllState(sound, rng)),
  });
  fullPresets.lastPresetId = fullPresetId(lastFactoryPreset.methodId, lastFactoryPreset.presetId);
  fullPresets.hasPresetInteraction = session.hasPresetInteraction;
  fullPresets.refresh();
  const host = $("presetHost");
  const next = host.querySelector(".header-preset-next");
  next.id = "nextPreset";
  next.title = "Next " + section + " preset";
  next.setAttribute("aria-label", next.title);
  const dice = host.querySelector(".header-preset-random");
  dice.id = "randomPreset";
  dice.title = section === "processing" ? "Randomize processor and its settings" : "Randomize synthesis method and its settings";
  dice.setAttribute("aria-label", dice.title);
  for (const selector of [".header-preset-controls", ".header-preset-picker summary", ".instrument-picker-list"]) {
    host.querySelector(selector)?.setAttribute("aria-label", (section === "processing" ? "Processing" : "Synthesis") + " presets");
  }
  host.querySelector("#header-preset-panel input").placeholder = "Search " + section + " presets";
}
populateTuningSelect();
populateSequenceSelect();
populatePerformancePresetSelects();
rebuildSequence({ route: false });
renderSection();
renderState();
mountSectionPresets();
for (const [id, label] of [["masterPresetSelect", "Choose master scene"], ["methodSelect", "Choose method"], ["sequenceSelect", "Choose arpeggiator or sequence"], ["sequencePresetSelect", "Choose arpeggiator settings preset"], ["tuningSelect", "Choose tuning and note map"], ["envelopePresetSelect", "Choose ADSR preset"], ["processingSource", "Choose processing input"], ["voiceMode", "Voicing"], ["touchstoneSelect", "Study"], ["spectrumMode", "Frequency display"]]) {
  chooseControls.set(id, enhanceChooseSelect($(id), { label }));
}
chooseControls.get("tuningSelect").summary.setAttribute("aria-describedby", "tuningSummary");
chooseControls.get("sequenceSelect").summary.setAttribute("aria-describedby", "sequenceCount");
for (const [labelId, selectId] of [["tuningLabel", "tuningSelect"], ["sequenceLabel", "sequenceSelect"]]) {
  listen($(labelId), "click", event => {
    event.preventDefault();
    const picker = chooseControls.get(selectId);
    picker.summary.focus({ preventScroll: true });
    if (!picker.details.open) picker.summary.click();
  });
}
paintSequenceMetadata();
paintSequenceParameterControls();
paintTuning();
paintEnvelopePreset();
refreshMasterPresetSelection();
paintAudio();
frames = requestAnimationFrame(animate);

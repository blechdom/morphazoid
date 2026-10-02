import { SYNTHESIS_DATES } from "./chronology.js";
import { createChaoticSpectrum, updateChaoticSpectrum, drawChaoticSpectrum } from "../../families/chaotic/chaotic-synth-visuals.js";
import { registerHeaderPresets } from "../../site/header-presets.js";
import { SECTION_METHODS, SECTION_PRESETS, methodSection, captureSoundState, fullPresetId, randomizeAllState, randomizeMethodState } from "./presets.js";
import { PROCESSING_SCHEMA } from "./processing-schema.js";
import { PROCESSING_INPUT_OPTIONS, getProcessingInput } from "./demo-sources.js";
import { enhanceChooseSelect } from "./choose.js";
import { COMPUTER_KEYBOARD_LAYOUTS } from "../../midi-manager.js";
import { getMethod, getPreset, createDefaultState, stateFromPreset, sanitizeState, formatParameter } from "./catalog.js";
import { SynthesisAudio } from "./audio.js";
import { mountAudioInputControl } from "../../audio-input-control.js";
import { createEnvelopeEditor } from "./envelope.js";
import { createParameterControl, createKnobControl } from "./controls.js";

const $ = id => document.getElementById(id);
const listeners = new AbortController();
const listen = (target, name, handler, options = {}) => target.addEventListener(name, handler, { ...options, signal: listeners.signal });
const query = new URLSearchParams(location.search);
let state = createDefaultState(query.get("method") || "additive");
if (query.has("preset")) state = stateFromPreset(state.methodId, query.get("preset"), state);
let playing = false;
let arming = false;
let configurationQueued = false;
let auditionQueued = false;
let fullPresets = null;
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

function showError(error) {
  $("audioError").hidden = false;
  $("audioError").textContent = error?.message || String(error);
  $("status").textContent = $("audioError").textContent;
}

function syncAudio(audition = false) {
  auditionQueued ||= audition;
  if (configurationQueued) return;
  configurationQueued = true;
  queueMicrotask(() => {
    configurationQueued = false;
    const method = getMethod(state.methodId);
    const audition = auditionQueued;
    auditionQueued = false;
    audio.configure({ ...state, source: method.kind === "processor" ? processingSource() : state.source, kind: method.kind || "synthesis", engineId: method.engineId, processorId: method.processorId, playStyle: playbackStyle() }, { audition });
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
  markCustom();
}
const frequencyField = createKnobControl({
  id: "frequency", editorId: "frequencyHz", label: "Frequency", min: 20, max: 8000,
  scale: "log", unit: "Hz", value: state.frequencyHz,
  formatValue: value => Number(value.toFixed(1)) + " Hz", onInput: setFrequency,
});
$("frequencyControl").append(frequencyField);
const tempoField = createKnobControl({ id: "tempo", label: "Tempo", min: 10, max: 1200, step: 1,
  value: 120, unit: "BPM", onInput: () => setPlaying(playing) });
const gateField = createKnobControl({ id: "noteGate", label: "Note length", min: 5, max: 95, step: 1,
  value: 65, unit: "%", onInput: () => setPlaying(playing) });
$("tempoControl").append(tempoField); $("gateControl").append(gateField);
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
  onChange(envelope) { state.envelope = envelope; markCustom(); },
});

function updateUrl() {
  const params = new URLSearchParams(location.search);
  params.set("method", state.methodId);
  if (state.presetId !== "custom") params.set("preset", state.presetId);
  else params.delete("preset");
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
  $("methodDate").textContent = milestone.dateLabel;
  $("methodDate").title = milestone.dateNote;
  $("methodDateNote").textContent = milestone.dateNote;
  $("methodDateReference").textContent = milestone.dateSource.label;
  $("methodDateReference").href = milestone.dateSource.url;
  $("modelNote").textContent = [method.depth, ...(Array.isArray(method.limitations) ? method.limitations : [method.limitations])].filter(Boolean).join(" ");
  $("methodReference").textContent = method.citation.label;
  $("methodReference").href = method.citation.url;
  const processing = method.kind === "processor";
  if (processing && held.size) releaseAll();
  $("randomMethodLabel").textContent = processing ? "Random effect" : "Random synth";
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
  if (rebuildControls) {
    controlFields.forEach(field => field.destroy());
    controlFields = method.controls.map((control, index) => createParameterControl(
      control, index, state.params[index], value => { state.params[index] = value; markCustom(); },
    ));
    $("methodControls").replaceChildren(...controlFields);
  } else controlFields.forEach((field, index) => field.setValue(state.params[index]));
  chooseControls.forEach(picker => picker.refresh());
  syncAudio(audition);
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
  state = sanitizeState({ ...sectionSessions[section].sound, outputLevel: state.outputLevel, voiceMode: state.voiceMode });
  renderState(true, true, true);
}
for (const button of document.querySelectorAll("button[data-section]")) listen(button, "click", () => switchSection(button.dataset.section));

listen($("methodSelect"), "change", () => {
  state = stateFromPreset($("methodSelect").value, null, state);
  renderState(true, true);
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

function playbackStyle() {
  if (getMethod(state.methodId).kind === "processor") return "process";
  return getMethod(state.methodId).playStyle === "strike" || state.envelope.sustain <= .001 ? "strike" : "hold";
}
function paintPlayback() {
  const repeats = playbackStyle() === "strike";
  const action = playing ? "Pause" : "Play";
  $("playButton").title = playbackStyle() === "process" ? `${action} processing demo` : repeats ? `${action} demo · pulse notes at the selected tempo` : `${action} demo · hold a continuous note`;
  $("tempoControl").title = $("gateControl").title = repeats ? "Demo notes pulse at this tempo and note length" : "Tempo and note length apply to percussive or zero-sustain sounds";
  tempoField.setDisabled(!repeats);
  gateField.setDisabled(!repeats);
}
function setPlaying(value) {
  playing = !!value;
  audio.setPlaying(playing, Number($("tempo").value) / 60, Number($("noteGate").value) / 100);
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
  for (const semitones of poly ? [0, 4, 7] : [0]) {
    let frequency = state.frequencyHz * 2 ** (semitones / 12);
    // Retain the chord's pitch classes at the top of the supported range.
    if (frequency > 8000) frequency /= 2;
    audio.noteOn(frequency, 0.8, duration, null, at);
  }
}
listen($("triggerButton"), "click", trigger);

function paintVoicing() {
  const processing = getMethod(state.methodId).kind === "processor";
  $("triggerButton").textContent = processing ? "Audition · 3 s" : state.voiceMode === "poly" ? "Trigger Notes (poly)" : "Trigger Note";
  $("triggerButton").title = processing ? "Audition the selected input for three seconds" : state.voiceMode === "poly" ? "Play a major chord: root, third and fifth" : "Play one note at the selected frequency";
  $("keyboardHelp").textContent = `Optional chromatic notes relative to the frequency above. Hold keys or note buttons. ${state.voiceMode === "poly" ? "Up to eight notes sound together, each with its own envelope." : "The most recent held note sounds."}`;
}
listen($("voiceMode"), "change", () => {
  state.voiceMode = $("voiceMode").value === "poly" ? "poly" : "mono";
  paintVoicing();
  syncAudio();
});
function press(id, frequency, velocity = 0.75) {
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
    button.setAttribute("aria-label", `Key ${button.textContent}, ${offset} semitones above base`);
    const start = () => press(code, Math.min(12000, state.frequencyHz * 2 ** (offset / 12)));
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
  event.preventDefault(); press(event.code, Math.min(12000, state.frequencyHz * 2 ** (offsets[event.code] / 12)));
});
listen(document, "keyup", event => { if (held.has(event.code)) release(event.code); });
listen(window, "blur", () => { if (held.size) releaseAll(); });
listen(document, "visibilitychange", () => { if (document.hidden && held.size) releaseAll(); });
listen(window, "morphazoid:midi-input", event => {
  if (event.detail?.routeId !== "synthesis") return;
  const message = event.detail.message;
  const id = `midi:${message.sourceId || "default"}:${message.channel || 0}:${message.note}`;
  if (message.type === "noteOn") { event.preventDefault(); press(id, 440 * 2 ** ((message.note - 69) / 12), message.velocity / 127); }
  else if (message.type === "noteOff") { event.preventDefault(); release(id); }
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
  applyState(value) { state = sanitizeState(value); renderState(); },
  trigger, release: releaseAll,
  getStatus: () => ({ armed: audio.armed, playing, section: activeSection, sampleRate: audio.context?.sampleRate || null, heldNotes: held.size, voiceMode: state.voiceMode, voiceLimit: state.voiceMode === "poly" ? 8 : 1, input: { ...audio.input.status(), selection: processingInput, source: processingSource(), loading: loadingInput }, tempo: Number($("tempo").value), playbackMode: "auto", playStyle: playbackStyle(), noteGate: Number($("noteGate").value) / 100 }),
});
listen(window, "pagehide", event => {
  releaseAll();
  audio.mute();
  paintAudio();
  if (event.persisted) audio.context?.suspend().catch(() => {});
  if (!event.persisted) {
    cancelAnimationFrame(frames); analysisResize.disconnect(); document.documentElement.style.removeProperty("--synthesis-analysis-inset"); listeners.abort(); controlFields.forEach(field => field.destroy());
    envelopeEditor.destroy(); frequencyField.destroy(); tempoField.destroy(); gateField.destroy();
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
      state = sanitizeState({ ...sound, outputLevel: state.outputLevel, voiceMode: state.voiceMode });
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
renderSection();
renderState();
mountSectionPresets();
for (const [id, label] of [["methodSelect", "Choose method"], ["processingSource", "Choose processing input"], ["voiceMode", "Voicing"], ["touchstoneSelect", "Study"], ["spectrumMode", "Frequency display"]]) {
  chooseControls.set(id, enhanceChooseSelect($(id), { label }));
}
paintAudio();
frames = requestAnimationFrame(animate);

import { fmDrumMidiAction } from "./src/fm-drums-midi.js";
import { getSharedMidiManager } from "./src/midi-manager.js";
import {
  SAMPLE_DRUM_STORAGE_KEY,
  SampleDrumAudio,
  cloneDefaultSampleDrumVoices,
  sanitizeSampleDrumVoice,
} from "./src/sample-drums.js";

const $ = (id) => document.getElementById(id);
const audio = new SampleDrumAudio(globalThis);
const midiManager = getSharedMidiManager(globalThis);
const defaultVoices = cloneDefaultSampleDrumVoices();
const PARAMETER_KEYS = ["pitch", "attack", "decay", "tone", "level"];

const clamp = (value, minimum, maximum) => Math.min(maximum, Math.max(minimum, Number(value) || 0));
const formatPitch = (value) => `${value >= 0 ? "+" : ""}${Number(value).toFixed(1)} st`;
const frequencyMacroToPitch = (frequency) => {
  const minimum = 35;
  const maximum = 6_000;
  const safe = clamp(frequency, minimum, maximum);
  const normalized = Math.log(safe / minimum) / Math.log(maximum / minimum);
  return -24 + normalized * 48;
};
const exponentialRange = (position, minimum, maximum) => {
  const normalized = clamp(position, 0, 1);
  return minimum * ((maximum / minimum) ** normalized);
};

const editorSpecs = [
  { key: "pitch", label: "Pitch", min: -24, max: 24, step: .1, format: formatPitch },
  { key: "attack", label: "Attack", min: .001, max: .25, step: .001, format: (value) => `${Math.round(value * 1_000)} ms` },
  { key: "decay", label: "Decay", min: .02, max: 3.5, step: .005, format: (value) => `${value.toFixed(2)} s` },
  { key: "tone", label: "Tone", min: 0, max: 1, step: .01, format: (value) => `${Math.round(value * 100)}%` },
  { key: "level", label: "Level", min: 0, max: 1, step: .01, format: (value) => `${Math.round(value * 100)}%` },
];

const state = {
  voices: loadBank(),
  selectedId: defaultVoices[0].id,
  audioOn: false,
  samplesLoading: false,
};
let audioLifecycleGeneration = 0;
let audioStartPromise = null;

function loadBank() {
  try {
    const stored = JSON.parse(localStorage.getItem(SAMPLE_DRUM_STORAGE_KEY));
    if (!Array.isArray(stored) || stored.length !== defaultVoices.length) return defaultVoices;
    return defaultVoices.map((fallback) => {
      const saved = stored.find((voice) => voice?.id === fallback.id);
      const parameters = Object.fromEntries(
        PARAMETER_KEYS.map((key) => [key, saved?.[key] ?? fallback[key]]),
      );
      return sanitizeSampleDrumVoice({ ...fallback, ...parameters });
    });
  } catch {
    return defaultVoices;
  }
}

function selectedVoice() {
  return state.voices.find((voice) => voice.id === state.selectedId) ?? state.voices[0];
}

function announce(message) {
  $("liveStatus").textContent = "";
  requestAnimationFrame(() => {
    $("liveStatus").textContent = message;
  });
}

function showError(error) {
  $("audioError").textContent = error instanceof Error ? error.message : String(error);
  $("audioError").hidden = false;
}

function updateSampleLoadState(message) {
  $("sampleLoadState").textContent = message;
  const loaded = audio.loadedSampleCount;
  $("sampleSourceState").textContent = loaded > 0
    ? `${loaded} of ${state.voices.length} decoded in RAM`
    : "TR-808 / TR-909 via pinned CDN URLs";
}

function setAudioState(enabled) {
  state.audioOn = enabled;
  $("audioButton").setAttribute("aria-pressed", String(enabled));
  $("audioState").textContent = enabled ? "on" : "off";
  $("sampleRateState").textContent = enabled && audio.context
    ? `${Math.round(audio.context.sampleRate / 1_000)} KHZ`
    : "AUDIO OFF";
  audio.setOutput(enabled ? Number($("output").value) : 0);
}

function enableAudio() {
  if (state.audioOn && audio.context) return Promise.resolve(true);
  if (audioStartPromise) return audioStartPromise;
  const lifecycleGeneration = audioLifecycleGeneration;
  $("audioError").hidden = true;
  let pending;
  pending = audio.start().then((context) => {
    if (
      lifecycleGeneration !== audioLifecycleGeneration
      || context !== audio.context
    ) return false;
    setAudioState(true);
    return true;
  }).catch((error) => {
    if (
      lifecycleGeneration !== audioLifecycleGeneration
      || error?.name === "AbortError"
    ) return false;
    showError(error);
    return false;
  }).finally(() => {
    if (audioStartPromise === pending) audioStartPromise = null;
  });
  audioStartPromise = pending;
  return pending;
}

async function preloadSamples() {
  if (state.samplesLoading) return;
  state.samplesLoading = true;
  const button = $("preloadSamples");
  button.disabled = true;
  button.textContent = "Loading";
  updateSampleLoadState("Loading samples");
  try {
    if (!await enableAudio()) return;
    const count = await audio.preload(state.voices);
    updateSampleLoadState(`${count} samples loaded`);
    button.textContent = "Loaded";
    setTimeout(() => {
      if (!state.samplesLoading) button.textContent = "Preload samples";
    }, 1_500);
    announce("Sample drum buffers decoded into RAM.");
  } catch (error) {
    showError(error);
    updateSampleLoadState("Sample loading failed");
  } finally {
    state.samplesLoading = false;
    button.disabled = false;
    if (button.textContent === "Loading") button.textContent = "Preload samples";
  }
}

async function triggerVoice(voice) {
  const lifecycleGeneration = audioLifecycleGeneration;
  if ((!state.audioOn || !audio.context) && !await enableAudio()) return;
  if (lifecycleGeneration !== audioLifecycleGeneration) return;
  try {
    if (!audio.hasBuffer(voice.url)) updateSampleLoadState(`Loading ${voice.name}`);
    await audio.trigger(voice);
    if (lifecycleGeneration !== audioLifecycleGeneration) return;
    updateSampleLoadState(`${audio.loadedSampleCount} samples ready`);
    const pad = $("padGrid").querySelector(`[data-voice-id="${voice.id}"]`);
    pad?.classList.add("is-active");
    setTimeout(() => pad?.classList.remove("is-active"), Math.min(520, voice.decay * 1_000 + 80));
    announce(`${voice.name} triggered.`);
  } catch (error) {
    if (
      lifecycleGeneration === audioLifecycleGeneration
      && error?.name !== "AbortError"
    ) showError(error);
  }
}

function selectVoice(id) {
  state.selectedId = id;
  for (const pad of $("padGrid").querySelectorAll(".fm-pad")) {
    pad.classList.toggle("is-selected", pad.dataset.voiceId === id);
  }
  renderEditor();
}

function makeMiniControl(voice, key, label, minimum, maximum, step) {
  const wrapper = document.createElement("label");
  wrapper.className = "fm-mini-control";
  const text = document.createElement("span");
  text.textContent = label;
  const input = document.createElement("input");
  input.type = "range";
  input.min = String(minimum);
  input.max = String(maximum);
  input.step = String(step);
  input.value = String(voice[key]);
  input.dataset.parameterKey = key;
  input.setAttribute("aria-label", `${voice.name} ${label}`);
  input.addEventListener("pointerdown", (event) => event.stopPropagation());
  input.addEventListener("input", () => {
    voice[key] = Number(input.value);
    refreshPad(voice);
    if (voice.id === state.selectedId) renderEditorIdentity();
  });
  wrapper.append(text, input);
  return wrapper;
}

function renderPads() {
  const fragment = document.createDocumentFragment();
  state.voices.forEach((voice, index) => {
    const pad = document.createElement("article");
    pad.className = `fm-pad${voice.id === state.selectedId ? " is-selected" : ""}`;
    pad.dataset.voiceId = voice.id;
    pad.style.setProperty("--voice-color", voice.color);

    const hit = document.createElement("button");
    hit.type = "button";
    hit.className = "fm-pad-hit";
    hit.setAttribute("aria-label", `Play ${voice.name} with ${voice.key.toUpperCase()}`);
    hit.innerHTML = `
      <span class="fm-pad-index">${String(index + 1).padStart(2, "0")}</span>
      <span class="fm-pad-key">${voice.key.toUpperCase()}</span>
      <strong>${voice.name}</strong>
      <small><span class="sample-machine-tag" data-voice-source>${voice.sourceLabel}</span> / <span data-voice-pitch>${formatPitch(voice.pitch)}</span></small>
    `;
    hit.addEventListener("pointerdown", (event) => {
      event.preventDefault();
      selectVoice(voice.id);
      triggerVoice(voice);
    });

    const controls = document.createElement("div");
    controls.className = "fm-pad-controls";
    controls.append(
      makeMiniControl(voice, "pitch", "PITCH", -24, 24, .1),
      makeMiniControl(voice, "decay", "DECAY", .02, 3.5, .005),
      makeMiniControl(voice, "tone", "TONE", 0, 1, .01),
    );
    pad.addEventListener("click", () => selectVoice(voice.id));
    pad.append(hit, controls);
    fragment.append(pad);
  });
  $("padGrid").replaceChildren(fragment);
}

function refreshPad(voice) {
  const pad = $("padGrid").querySelector(`[data-voice-id="${voice.id}"]`);
  const pitch = pad?.querySelector("[data-voice-pitch]");
  if (pitch) pitch.textContent = formatPitch(voice.pitch);
  for (const input of pad?.querySelectorAll("[data-parameter-key]") ?? []) {
    const key = input.dataset.parameterKey;
    input.value = String(voice[key]);
  }
}

function renderEditorIdentity() {
  const voice = selectedVoice();
  const index = state.voices.findIndex((item) => item.id === voice.id);
  $("voiceEditor").style.setProperty("--voice-color", voice.color);
  $("voiceNumber").textContent = String(index + 1).padStart(2, "0");
  $("voiceEditorTitle").textContent = voice.name;
  $("voiceMeta").textContent = `KEY ${voice.key.toUpperCase()} · ${voice.sourceLabel}`;
}

function renderEditor() {
  const voice = selectedVoice();
  renderEditorIdentity();
  const fragment = document.createDocumentFragment();
  for (const spec of editorSpecs) {
    const label = document.createElement("label");
    label.className = "fm-editor-control";
    const heading = document.createElement("span");
    const name = document.createElement("b");
    const output = document.createElement("output");
    name.textContent = spec.label.toUpperCase();
    output.textContent = spec.format(voice[spec.key]);
    heading.append(name, output);
    const input = document.createElement("input");
    input.type = "range";
    input.min = String(spec.min);
    input.max = String(spec.max);
    input.step = String(spec.step);
    input.value = String(voice[spec.key]);
    input.dataset.parameterKey = spec.key;
    input.addEventListener("input", () => {
      voice[spec.key] = Number(input.value);
      output.textContent = spec.format(voice[spec.key]);
      refreshPad(voice);
    });
    label.append(heading, input);
    fragment.append(label);
  }
  $("editorControls").replaceChildren(fragment);
}

function refreshEditorControls(voice) {
  renderEditorIdentity();
  for (const spec of editorSpecs) {
    const input = $("editorControls").querySelector(
      `[data-parameter-key="${spec.key}"]`,
    );
    if (!input) continue;
    input.value = String(voice[spec.key]);
    const output = input.closest(".fm-editor-control")?.querySelector("output");
    if (output) output.textContent = spec.format(voice[spec.key]);
  }
}

function setTemporaryButtonText(button, text, delay = 1_500) {
  const original = button.textContent;
  button.textContent = text;
  setTimeout(() => {
    button.textContent = original;
  }, delay);
}

function updateSampleDrumVoiceFromMidi(voice, action) {
  if (!voice || action?.type !== "voice") return voice;
  const updates = {};
  if (action.key === "frequency") updates.pitch = frequencyMacroToPitch(action.value);
  if (action.key === "pitchBend") updates.pitch = -24 + ((action.value + 1) / 9) * 48;
  if (action.key === "attack") updates.attack = action.value;
  if (action.key === "decay") updates.decay = action.value;
  if (action.key === "tone" || action.key === "noise") updates.tone = action.value;
  if (action.key === "modIndex") updates.tone = action.value / 20;
  if (action.key === "modRatio") updates.tone = (action.value - .25) / 7.75;
  if (action.key === "level") updates.level = action.value;
  return Object.keys(updates).length ? sanitizeSampleDrumVoice({ ...voice, ...updates }) : voice;
}

function applyMidiVoiceUpdate(action) {
  const index = state.voices.findIndex((voice) => voice.id === state.selectedId);
  if (index < 0) return;
  const voice = state.voices[index];
  const updated = updateSampleDrumVoiceFromMidi(voice, action);
  if (updated !== voice) Object.assign(voice, updated);
  refreshPad(voice);
  refreshEditorControls(voice);
  announce(`${voice.name} ${action.key} mapped from MIDI.`);
}

function sampleMidiTriggerVoice(voice, velocityGain) {
  return sanitizeSampleDrumVoice({
    ...voice,
    level: voice.level * clamp(velocityGain, 0, 1),
  });
}

function sampleMacroAction(index, normalizedValue) {
  const normalized = clamp(normalizedValue, 0, 1);
  switch (Math.round(Number(index))) {
    case 0: return Object.freeze({ type: "voice", key: "frequency", value: 35 * ((6_000 / 35) ** normalized) });
    case 1: return Object.freeze({ type: "voice", key: "decay", value: exponentialRange(normalized, .02, 3.5) });
    case 2: return Object.freeze({ type: "voice", key: "tone", value: normalized });
    case 3: return Object.freeze({ type: "voice", key: "level", value: normalized });
    default: return null;
  }
}

function sampleDrumMidiAction(event) {
  if (event?.logical?.type === "macro") {
    return sampleMacroAction(event.logical.index, event.logical.normalized);
  }
  return fmDrumMidiAction(event);
}

function handleMidiMessage(message) {
  const action = sampleDrumMidiAction(message);
  if (!action) return;
  if (action.type === "trigger") {
    const voice = state.voices[action.voiceIndex];
    if (!voice) return;
    selectVoice(voice.id);
    void triggerVoice(sampleMidiTriggerVoice(voice, action.velocityGain));
    return;
  }
  if (action.type === "master") {
    $("output").value = String(action.value);
    $("output").dispatchEvent(new Event("input", { bubbles: true }));
    announce(`Sample drums output ${Math.round(action.value / 0.9 * 100)} percent.`);
    return;
  }
  applyMidiVoiceUpdate(action);
}

$("audioButton").addEventListener("click", async () => {
  if (state.audioOn) {
    setAudioState(false);
    announce("Sample Drums audio off.");
  } else if (await enableAudio()) {
    announce("Sample Drums audio on.");
  }
});

$("output").addEventListener("input", () => {
  const value = Number($("output").value);
  $("outputOut").textContent = `${Math.round(value * 100)}%`;
  if (state.audioOn) audio.setOutput(value);
});

$("preloadSamples").addEventListener("click", preloadSamples);
$("auditionVoice").addEventListener("click", () => triggerVoice(selectedVoice()));

$("saveBank").addEventListener("click", () => {
  try {
    localStorage.setItem(SAMPLE_DRUM_STORAGE_KEY, JSON.stringify(state.voices));
    setTemporaryButtonText($("saveBank"), "Bank saved");
    announce("Sample drum bank saved in this browser.");
  } catch (error) {
    showError(error);
  }
});

$("copyBank").addEventListener("click", async () => {
  try {
    await navigator.clipboard.writeText(JSON.stringify(state.voices, null, 2));
    setTemporaryButtonText($("copyBank"), "Copied");
    announce("Sample drum preset JSON copied.");
  } catch (error) {
    showError(error);
  }
});

$("resetSet").addEventListener("click", () => {
  state.voices = cloneDefaultSampleDrumVoices();
  state.selectedId = state.voices[0].id;
  localStorage.removeItem(SAMPLE_DRUM_STORAGE_KEY);
  renderPads();
  renderEditor();
  updateSampleLoadState(`${audio.loadedSampleCount} samples ready`);
  announce("Sample drum set reset.");
});

function randomizeVoiceSettings(voice) {
  voice.pitch = clamp(voice.pitch + (Math.random() - .5) * 7, -24, 24);
  voice.decay = clamp(voice.decay * (.7 + Math.random() * .75), .02, 3.5);
  voice.tone = Math.random();
  return voice;
}

$("randomizeVoice").addEventListener("click", () => {
  const voice = randomizeVoiceSettings(selectedVoice());
  renderPads();
  renderEditor();
  triggerVoice(voice);
  announce(`${voice.name} randomized.`);
});

$("randomizeSet").addEventListener("click", () => {
  state.voices.forEach(randomizeVoiceSettings);
  renderPads();
  renderEditor();
  announce("All sixteen sample drum voices randomized.");
});

$("downloadBank").addEventListener("click", () => {
  try {
    const data = JSON.stringify(state.voices, null, 2);
    const blob = new Blob([data], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    const date = new Date().toISOString().slice(0, 10);
    link.href = url;
    link.download = `morphazoid-sample-drums-${date}.json`;
    link.hidden = true;
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 0);
    setTemporaryButtonText($("downloadBank"), "Downloaded");
    announce("Sample drum set downloaded as JSON.");
  } catch (error) {
    showError(error);
  }
});

document.addEventListener("keydown", (event) => {
  if (midiManager.enabled) return;
  if (event.repeat || ["INPUT", "BUTTON", "SELECT"].includes(event.target?.tagName)) return;
  const voice = state.voices.find((item) => item.key === event.key.toLowerCase());
  if (!voice) return;
  event.preventDefault();
  selectVoice(voice.id);
  triggerVoice(voice);
});

renderPads();
renderEditor();
updateSampleLoadState("Samples not loaded");

let unregisterMidi = null;

function registerMidiClient() {
  if (unregisterMidi) return;
  unregisterMidi = midiManager.registerClient({
    id: "sample-drums",
    computerKeyboard: { layout: "pad-grid", baseNote: 36, velocity: 110 },
    onPrepareEnable: () => {
      if (!state.audioOn) void enableAudio();
    },
    onMessage: handleMidiMessage,
    onEnabledChange: (enabled) => {
      if (enabled) announce("MIDI ready. Pads or notes 36 through 51 play the sixteen sample voices.");
    },
  });
}

window.addEventListener("pagehide", () => {
  audioLifecycleGeneration += 1;
  audioStartPromise = null;
  unregisterMidi?.();
  unregisterMidi = null;
  setAudioState(false);
  void audio.close().catch(() => {});
});

window.addEventListener("pageshow", (event) => {
  if (!event.persisted) return;
  registerMidiClient();
  setAudioState(false);
});

registerMidiClient();

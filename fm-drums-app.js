import {
  cloneDefaultFmDrumVoices,
  FM_DRUM_STORAGE_KEY,
  FmDrumAudio,
  frequencyFromSlider,
  frequencySliderPosition,
  sanitizeFmDrumVoice,
} from "./src/fm-drums.js";

const $ = (id) => document.getElementById(id);
const audio = new FmDrumAudio(globalThis);
const defaultVoices = cloneDefaultFmDrumVoices();
const PARAMETER_KEYS = [
  "frequency", "attack", "decay", "modRatio", "modIndex",
  "pitchBend", "noise", "tone", "level",
];

const editorSpecs = [
  { key: "frequency", label: "Tune", min: 0, max: 1, step: .0001, read: frequencyFromSlider, write: frequencySliderPosition, format: (value) => `${Math.round(value)} Hz` },
  { key: "attack", label: "Attack", min: .001, max: .25, step: .001, format: (value) => `${Math.round(value * 1_000)} ms` },
  { key: "decay", label: "Decay", min: .035, max: 3, step: .005, format: (value) => `${value.toFixed(2)} s` },
  { key: "modRatio", label: "FM ratio", min: .25, max: 8, step: .01, format: (value) => value.toFixed(2) },
  { key: "modIndex", label: "FM index", min: 0, max: 20, step: .1, format: (value) => value.toFixed(1) },
  { key: "pitchBend", label: "Pitch sweep", min: -1, max: 8, step: .05, format: (value) => `${value.toFixed(2)}×` },
  { key: "noise", label: "Noise", min: 0, max: 1, step: .01, format: (value) => `${Math.round(value * 100)}%` },
  { key: "tone", label: "Tone", min: 0, max: 1, step: .01, format: (value) => `${Math.round(value * 100)}%` },
  { key: "level", label: "Level", min: 0, max: 1, step: .01, format: (value) => `${Math.round(value * 100)}%` },
];

const state = {
  voices: loadBank(),
  selectedId: defaultVoices[0].id,
  audioOn: false,
};

function loadBank() {
  try {
    const stored = JSON.parse(localStorage.getItem(FM_DRUM_STORAGE_KEY));
    if (!Array.isArray(stored) || stored.length !== defaultVoices.length) return defaultVoices;
    return defaultVoices.map((fallback) => {
      const saved = stored.find((voice) => voice?.id === fallback.id);
      const parameters = Object.fromEntries(
        PARAMETER_KEYS.map((key) => [key, saved?.[key] ?? fallback[key]]),
      );
      return sanitizeFmDrumVoice({ ...fallback, ...parameters });
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

function setAudioState(enabled) {
  state.audioOn = enabled;
  $("audioButton").setAttribute("aria-pressed", String(enabled));
  $("audioState").textContent = enabled ? "on" : "off";
  $("sampleRateState").textContent = enabled && audio.context
    ? `${Math.round(audio.context.sampleRate / 1_000)} KHZ`
    : "AUDIO OFF";
  audio.setOutput(enabled ? Number($("output").value) : 0);
}

async function enableAudio() {
  try {
    $("audioError").hidden = true;
    await audio.start();
    setAudioState(true);
    return true;
  } catch (error) {
    showError(error);
    return false;
  }
}

async function triggerVoice(voice) {
  if (!state.audioOn && !await enableAudio()) return;
  try {
    await audio.trigger(voice);
    const pad = $("padGrid").querySelector(`[data-voice-id="${voice.id}"]`);
    pad?.classList.add("is-active");
    setTimeout(() => pad?.classList.remove("is-active"), Math.min(520, voice.decay * 1_000 + 80));
    announce(`${voice.name} triggered.`);
  } catch (error) {
    showError(error);
  }
}

function selectVoice(id) {
  state.selectedId = id;
  for (const pad of $("padGrid").querySelectorAll(".fm-pad")) {
    pad.classList.toggle("is-selected", pad.dataset.voiceId === id);
  }
  renderEditor();
}

function makeMiniControl(voice, key, label, minimum, maximum, step, {
  read = (value) => value,
  write = (value) => value,
} = {}) {
  const wrapper = document.createElement("label");
  wrapper.className = "fm-mini-control";
  const text = document.createElement("span");
  text.textContent = label;
  const input = document.createElement("input");
  input.type = "range";
  input.min = String(minimum);
  input.max = String(maximum);
  input.step = String(step);
  input.value = String(write(voice[key]));
  input.setAttribute("aria-label", `${voice.name} ${label}`);
  input.addEventListener("pointerdown", (event) => event.stopPropagation());
  input.addEventListener("input", () => {
    voice[key] = read(Number(input.value));
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
      <small><span data-voice-family>${voice.family}</span> / <span data-voice-frequency>${Math.round(voice.frequency)}</span> Hz</small>
    `;
    hit.addEventListener("pointerdown", (event) => {
      event.preventDefault();
      selectVoice(voice.id);
      triggerVoice(voice);
    });

    const controls = document.createElement("div");
    controls.className = "fm-pad-controls";
    controls.append(
      makeMiniControl(voice, "frequency", "TUNE", 0, 1, .0001, {
        read: frequencyFromSlider,
        write: frequencySliderPosition,
      }),
      makeMiniControl(voice, "decay", "DECAY", .035, 3, .005),
      makeMiniControl(voice, "modIndex", "CHAR", 0, 20, .1),
    );
    pad.addEventListener("click", () => selectVoice(voice.id));
    pad.append(hit, controls);
    fragment.append(pad);
  });
  $("padGrid").replaceChildren(fragment);
}

function refreshPad(voice) {
  const pad = $("padGrid").querySelector(`[data-voice-id="${voice.id}"]`);
  const frequency = pad?.querySelector("[data-voice-frequency]");
  if (frequency) frequency.textContent = String(Math.round(voice.frequency));
}

function renderEditorIdentity() {
  const voice = selectedVoice();
  const index = state.voices.findIndex((item) => item.id === voice.id);
  $("voiceEditor").style.setProperty("--voice-color", voice.color);
  $("voiceNumber").textContent = String(index + 1).padStart(2, "0");
  $("voiceEditorTitle").textContent = voice.name;
  $("voiceMeta").textContent = `KEY ${voice.key.toUpperCase()} · ${voice.family.toUpperCase()}`;
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
    input.value = String(spec.write ? spec.write(voice[spec.key]) : voice[spec.key]);
    input.addEventListener("input", () => {
      voice[spec.key] = spec.read ? spec.read(Number(input.value)) : Number(input.value);
      output.textContent = spec.format(voice[spec.key]);
      refreshPad(voice);
    });
    label.append(heading, input);
    fragment.append(label);
  }
  $("editorControls").replaceChildren(fragment);
}

function setTemporaryButtonText(button, text, delay = 1_500) {
  const original = button.textContent;
  button.textContent = text;
  setTimeout(() => {
    button.textContent = original;
  }, delay);
}

$("audioButton").addEventListener("click", async () => {
  if (state.audioOn) {
    setAudioState(false);
    announce("FM Drums audio off.");
  } else if (await enableAudio()) {
    announce("FM Drums audio on.");
  }
});

$("output").addEventListener("input", () => {
  const value = Number($("output").value);
  $("outputOut").textContent = `${Math.round(value * 100)}%`;
  if (state.audioOn) audio.setOutput(value);
});

$("auditionVoice").addEventListener("click", () => triggerVoice(selectedVoice()));

$("saveBank").addEventListener("click", () => {
  try {
    localStorage.setItem(FM_DRUM_STORAGE_KEY, JSON.stringify(state.voices));
    setTemporaryButtonText($("saveBank"), "Bank saved ✓");
    announce("FM drum bank saved in this browser.");
  } catch (error) {
    showError(error);
  }
});

$("copyBank").addEventListener("click", async () => {
  try {
    await navigator.clipboard.writeText(JSON.stringify(state.voices, null, 2));
    setTemporaryButtonText($("copyBank"), "Copied ✓");
    announce("FM drum preset JSON copied.");
  } catch (error) {
    showError(error);
  }
});

$("resetSet").addEventListener("click", () => {
  state.voices = cloneDefaultFmDrumVoices();
  state.selectedId = state.voices[0].id;
  localStorage.removeItem(FM_DRUM_STORAGE_KEY);
  renderPads();
  renderEditor();
  announce("FM drum set reset.");
});

function randomizeVoiceSettings(voice) {
  voice.frequency = Math.round(Math.min(6_000, Math.max(35, voice.frequency * (.72 + Math.random() * .6))));
  voice.decay = Math.min(3, Math.max(.04, voice.decay * (.65 + Math.random() * .8)));
  voice.modRatio = Math.min(8, Math.max(.25, voice.modRatio + (Math.random() - .5) * 1.5));
  voice.modIndex = Math.min(20, Math.max(0, voice.modIndex + (Math.random() - .5) * 6));
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
  announce("All sixteen FM drum voices randomized.");
});

$("downloadBank").addEventListener("click", () => {
  try {
    const data = JSON.stringify(state.voices, null, 2);
    const blob = new Blob([data], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    const date = new Date().toISOString().slice(0, 10);
    link.href = url;
    link.download = `morphazoid-fm-drums-${date}.json`;
    link.hidden = true;
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 0);
    setTemporaryButtonText($("downloadBank"), "Downloaded ✓");
    announce("FM drum set downloaded as JSON.");
  } catch (error) {
    showError(error);
  }
});

document.addEventListener("keydown", (event) => {
  if (event.repeat || ["INPUT", "BUTTON", "SELECT"].includes(event.target?.tagName)) return;
  const voice = state.voices.find((item) => item.key === event.key.toLowerCase());
  if (!voice) return;
  event.preventDefault();
  selectVoice(voice.id);
  triggerVoice(voice);
});

renderPads();
renderEditor();

import { createButton } from "../ui/primitives/button.js";
import { IOAudioTest, IOMidiTest, OUTPUT_LAYOUTS, gainToDb, loadSettings, saveSettings } from "./io-settings.js";

const $ = (id) => document.getElementById(id);
const prefs = loadSettings();
const host = Boolean(globalThis.MorphazoidWAX);
let audioPending = false;
let micPending = false;
let midiPending = false;
let devicePending = false;
let disposed = false;
let sessionVersion = 0;
let micRequestVersion = 0;
let received = 0;
let lastReceived = -Infinity;
let lastLogPaint = 0;
let logDirty = false;
let messageLog = [];
let clippedUntil = 0;
let lastInputState = "";
let lastChannelState = "";
let speakerCheckStarted = false;
const audio = new IOAudioTest(globalThis, (message) => {
  if (message) $("setupStatus").textContent = message;
  render();
});
const midi = new IOMidiTest(globalThis, (message) => {
  received++;
  lastReceived = performance.now();
  messageLog.unshift(message);
  messageLog.length = Math.min(messageLog.length, 40);
  logDirty = true;
  if (prefs.announce && message.announce) audio.announce().catch(showError);
}, render);
const audioButton = createButton({ id: "audioToggle", variant: "audio", label: "Audio", audioState: "off" });
$("audioControl").append(audioButton);

function save() {
  if (!saveSettings(prefs)) $("savedStatus").textContent = "Browser storage is unavailable. Preferences last for this visit only.";
}
function showError(error) {
  if (disposed) return;
  const names = {
    NotAllowedError: "Permission was denied. Allow access in the browser’s site settings, then try again.",
    NotFoundError: "That device is unavailable. Connect it and refresh devices, or choose System default.",
    NotReadableError: "That device could not be opened. Check whether another application is using it.",
    OverconstrainedError: "The selected input is no longer available. Choose another input or System default.",
  };
  $("setupError").textContent = names[error?.name] || error?.message || String(error);
  $("setupError").hidden = false;
}
function clearError() { $("setupError").hidden = true; }
function action(id, handler) {
  $(id).addEventListener("click", async () => {
    clearError();
    try { await handler(); } catch (error) { showError(error); }
    render();
  });
}
function setOptions(select, devices, firstLabel, selected, valueKey = "deviceId") {
  const choices = [{ value: "", label: firstLabel }];
  for (const [index, device] of devices.entries()) {
    const value = device[valueKey];
    if (!value || choices.some((choice) => choice.value === value)) continue;
    choices.push({ value, label: device.label || device.name || `Device ${index + 1}` });
  }
  if (selected && !choices.some((choice) => choice.value === selected)) {
    choices.push({ value: selected, label: "Saved device · unavailable / permission needed" });
  }
  select.replaceChildren(...choices.map(({ value, label }) => new Option(label, value)));
  select.value = selected;
}

async function refreshDevices() {
  if (host || !navigator.mediaDevices?.enumerateDevices) return;
  const devices = await navigator.mediaDevices.enumerateDevices();
  if (disposed) return;
  setOptions($("inputDevice"), devices.filter(({ kind }) => kind === "audioinput"), "System default", prefs.inputId);
  await audio.output.refreshOutputDevices();
  if (disposed) return;
  setOptions($("outputDevice"), devices.filter(({ kind }) => kind === "audiooutput"), "System default", audio.output.outputStatus().selectedId);
}

function renderSpeakers() {
  for (const button of $("speakerMap").querySelectorAll("button")) button.remove();
  OUTPUT_LAYOUTS[prefs.layout].forEach((channel, index) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "io-speaker";
    button.dataset.channel = index;
    button.setAttribute("aria-label", `Test channel ${index + 1}: ${channel.label}`);
    button.innerHTML = `<span>${index + 1}</span>${channel.label}`;
    button.addEventListener("click", () => {
      try {
        audio.testChannels([index], prefs.signal);
        speakerCheckStarted = true;
      } catch (error) { showError(error); }
      render();
    });
    $("speakerMap").append(button);
  });
}

function render() {
  if (disposed) return;
  const active = audio.active;
  audioButton.setAudioState(audioPending ? "starting" : active ? "on" : "off");
  audioButton.disabled = host || audioPending;
  $("audioState").textContent = audioPending ? "Starting…" : active ? "Audio on" : "Audio off";
  $("outputBadge").textContent = active ? "Ready" : "Off";
  $("outputBadge").classList.toggle("is-active", active);
  const sink = audio.output.outputStatus();
  $("outputDevice").disabled = host || !sink.canSelect || devicePending || audioPending;
  $("chooseOutput").disabled = host || !sink.canSelect || devicePending || typeof navigator.mediaDevices?.selectAudioOutput !== "function";
  $("outputSupport").textContent = !sink.canSelect
    ? "This browser uses the system output. Choose speakers in your operating system’s sound settings."
    : typeof navigator.mediaDevices?.selectAudioOutput === "function"
      ? "Choose / grant speaker access to expose another output. No microphone permission is needed for that action."
      : "Choose from permitted outputs, or use system sound settings. Enabling the microphone may expose more device labels.";
  if (audio.context) {
    if (!audioPending && prefs.layout !== audio.layout) {
      prefs.layout = audio.layout;
      $("speakerLayout").value = prefs.layout;
      renderSpeakers();
      save();
    }
    const ms = Number(audio.context.baseLatency) * 1000;
    $("outputInfo").textContent = `${audio.context.sampleRate.toLocaleString()} Hz · ${audio.maxChannels} channels reported by browser${Number.isFinite(ms) ? ` · ${ms.toFixed(1)} ms base latency (not round-trip)` : ""}`;
  }
  for (const option of $("speakerLayout").options) option.disabled = Boolean(audio.context && OUTPUT_LAYOUTS[option.value].length > audio.maxChannels);
  $("speakerLayout").disabled = host || audioPending || devicePending;
  for (const button of $("speakerMap").querySelectorAll("button")) button.disabled = !active || devicePending;
  for (const id of ["testAll", "previewVoice"]) $(id).disabled = !active || devicePending;
  $("stopTest").disabled = !active;
  $("micToggle").disabled = host || (!active && !micPending);
  $("micToggle").textContent = micPending ? "Cancel request" : audio.mic ? "Stop input" : "Test input";
  $("micToggle").setAttribute("aria-pressed", String(Boolean(audio.mic)));
  $("inputBadge").textContent = micPending ? "Requesting…" : audio.mic ? "Connected" : "Off";
  $("inputBadge").classList.toggle("is-active", Boolean(audio.mic));
  $("inputDevice").disabled = host || micPending;
  $("inputChannels").disabled = host || micPending;
  $("echoCancellation").disabled = host || micPending;
  $("monitorInput").disabled = !audio.mic || !active;
  $("monitorInput").checked = Boolean(audio.mic?.monitoring);
  const stereoInput = prefs.inputChannels === 2;
  for (const meter of document.querySelectorAll(".io-right-meter")) meter.hidden = !stereoInput;
  $("inputLeftLabel").textContent = stereoInput ? "Left" : "Level";
  if (audio.mic) {
    const settings = audio.mic.settings;
    const flag = (value) => value === undefined ? "not reported" : value ? "on" : "off";
    $("inputInfo").textContent = `${audio.mic.track.label || "Audio input"} · ${settings.channelCount === 2 ? "stereo capture" : settings.channelCount === 1 ? "mono capture" : "capture channel count not reported"} · ${settings.sampleRate ? `${settings.sampleRate} Hz` : "rate not reported"} · echo cancellation ${flag(settings.echoCancellation)} · auto gain ${flag(settings.autoGainControl)} · noise suppression ${flag(settings.noiseSuppression)}.${prefs.inputChannels === 2 && settings.channelCount === 1 ? " Stereo requested, but this device provided mono." : ""}`;
  }
  $("midiToggle").disabled = host || midiPending || !navigator.requestMIDIAccess;
  $("midiToggle").textContent = midiPending ? "Requesting…" : midi.access ? "Stop MIDI" : "Test MIDI";
  $("midiToggle").setAttribute("aria-pressed", String(Boolean(midi.access)));
  $("midiBadge").textContent = midi.access ? received ? `${received} received` : "Listening" : "Off";
  $("midiBadge").classList.toggle("is-active", Boolean(midi.access));
  $("midiInput").disabled = $("midiOutput").disabled = !midi.access;
  setOptions($("midiInput"), midi.ports("inputs"), "All inputs", prefs.midiInputId, "id");
  setOptions($("midiOutput"), midi.ports("outputs"), "None · no MIDI sent", prefs.midiOutputId, "id");
  $("sendNote").disabled = !midi.ports("outputs").some(({ id }) => id === prefs.midiOutputId);
  if (!navigator.requestMIDIAccess) $("midiStatus").textContent = "Web MIDI is not available here. Use a Web MIDI-capable browser over HTTPS or localhost.";
  else if (midi.access) {
    const selectedMissing = prefs.midiInputId && !midi.ports("inputs").some(({ id }) => id === prefs.midiInputId);
    $("midiStatus").textContent = selectedMissing ? "Selected input disconnected. Reconnect it or select All inputs."
      : midi.ports("inputs").length ? "Listening. Play a note or move a controller." : "No MIDI inputs connected. Plug in a controller; this list updates automatically.";
  } else $("midiStatus").textContent = "Start the test, then play a key or move a control.";
}

for (let n = 1; n <= 16; n++) {
  $("midiChannel").append(new Option(String(n), String(n)));
  if (n > 1) $("sendChannel").append(new Option(String(n), String(n)));
}
for (const [id, key] of [
  ["speakerLayout", "layout"], ["outputLevel", "outputDb"], ["inputGain", "inputDb"],
  ["inputDevice", "inputId"], ["inputChannels", "inputChannels"], ["midiChannel", "midiChannel"], ["testSignal", "signal"],
]) $(id).value = prefs[key];
$("echoCancellation").checked = prefs.echoCancellation;
$("announceMidi").checked = prefs.announce;
const formatDb = (value) => `${value > 0 ? "+" : ""}${value} dB`;
$("outputLevelValue").textContent = formatDb(prefs.outputDb);
$("inputGainValue").textContent = formatDb(prefs.inputDb);
midi.inputId = prefs.midiInputId;
midi.outputId = prefs.midiOutputId;
midi.channel = prefs.midiChannel;
renderSpeakers();
render();

action("audioToggle", async () => {
  if (audio.active) {
    micRequestVersion++;
    micPending = false;
    await audio.disable();
    $("setupStatus").textContent = "Audio and input are off. MIDI has its own test switch.";
    return;
  }
  const version = ++sessionVersion;
  audioPending = true;
  render();
  try {
    await audio.enable(prefs);
    if (audio.active) $("setupStatus").textContent = "Audio is on. Choose something to test.";
    await refreshDevices();
  } finally { if (version === sessionVersion) audioPending = false; }
});
action("stopAll", async () => {
  sessionVersion++;
  micRequestVersion++;
  audioPending = false;
  micPending = false;
  midiPending = false;
  speakerCheckStarted = false;
  midi.disable();
  await audio.disable();
  $("setupStatus").textContent = "All stopped. No devices are active.";
});
action("testAll", () => {
  audio.testChannels(OUTPUT_LAYOUTS[prefs.layout].map((_, index) => index), prefs.signal);
  speakerCheckStarted = true;
});
action("stopTest", () => { audio.stopTests(); speakerCheckStarted = false; });
action("previewVoice", () => audio.announce({ preview: true }));
action("refreshDevices", refreshDevices);
action("chooseOutput", async () => {
  const version = sessionVersion;
  devicePending = true;
  render();
  try {
    const device = await navigator.mediaDevices.selectAudioOutput();
    if (disposed || version !== sessionVersion) return;
    await audio.setOutput(device.deviceId);
    await refreshDevices();
  } finally { devicePending = false; }
});
$("outputDevice").addEventListener("change", async () => {
  clearError();
  devicePending = true;
  render();
  try {
    await audio.setOutput($("outputDevice").value);
    $("setupStatus").textContent = "Output selected. Play a test sound to check it.";
  } catch (error) { showError(error); }
  finally {
    devicePending = false;
    $("outputDevice").value = audio.output.outputStatus().selectedId;
    render();
  }
});
$("speakerLayout").addEventListener("change", () => {
  try {
    audio.setLayout($("speakerLayout").value);
    prefs.layout = audio.layout;
    renderSpeakers();
    render();
    save();
  } catch (error) { $("speakerLayout").value = prefs.layout; showError(error); }
});
for (const [id, key, outputId, setter] of [
  ["outputLevel", "outputDb", "outputLevelValue", (v) => audio.setOutputDb(v)],
  ["inputGain", "inputDb", "inputGainValue", (v) => audio.setInputDb(v)],
]) {
  $(id).addEventListener("input", () => {
    prefs[key] = Number($(id).value);
    $(outputId).textContent = formatDb(prefs[key]);
    setter(prefs[key]); save();
  });
}
$("testSignal").addEventListener("change", () => { prefs.signal = $("testSignal").value; save(); });

async function startMic() {
  const version = ++micRequestVersion;
  micPending = true;
  render();
  try {
    if (await audio.startMic(prefs)) {
      clippedUntil = 0;
      $("setupStatus").textContent = "Input connected. Speak or send audio to check the levels.";
    }
    await refreshDevices();
  }
  finally { if (version === micRequestVersion) micPending = false; render(); }
}
action("micToggle", async () => {
  if (audio.mic || micPending) { micRequestVersion++; audio.stopMic(); micPending = false; }
  else await startMic();
});
for (const [id, key] of [["inputDevice", "inputId"], ["inputChannels", "inputChannels"], ["echoCancellation", "echoCancellation"]]) {
  $(id).addEventListener("change", async () => {
    prefs[key] = id === "inputDevice" ? $(id).value : id === "inputChannels" ? Number($(id).value) : $(id).checked;
    save();
    if (audio.mic) try { await startMic(); } catch (error) { showError(error); }
    render();
  });
}
$("monitorInput").addEventListener("change", () => { audio.stopTests(); audio.setMonitor($("monitorInput").checked); render(); });
action("midiToggle", async () => {
  if (midi.access) { midi.disable(); return; }
  midiPending = true; render();
  const version = sessionVersion;
  try { await midi.enable(); } finally { if (version === sessionVersion) midiPending = false; }
});
$("midiInput").addEventListener("change", () => { prefs.midiInputId = $("midiInput").value; midi.selectInput(prefs.midiInputId); save(); render(); });
$("midiOutput").addEventListener("change", () => { prefs.midiOutputId = $("midiOutput").value; midi.selectOutput(prefs.midiOutputId); save(); render(); });
$("midiChannel").addEventListener("change", () => { midi.channel = prefs.midiChannel = Number($("midiChannel").value); save(); });
$("announceMidi").addEventListener("change", () => { prefs.announce = $("announceMidi").checked; save(); if (!prefs.announce) audio.stopTests(); });
action("sendNote", () => { midi.testNote(Number($("sendChannel").value)); $("setupStatus").textContent = "Sent one short C4 note to your MIDI output."; });
action("clearMidi", () => { messageLog = []; received = 0; logDirty = true; });

function paintMeters() {
  const now = performance.now();
  const level = audio.readInput();
  if (level?.raw.clipped || level?.adjusted.clipped || level?.rawRight.clipped || level?.adjustedRight.clipped) clippedUntil = now + 1500;
  for (const [id, values] of [["raw", level?.raw], ["adjusted", level?.adjusted], ["rawRight", level?.rawRight], ["adjustedRight", level?.adjustedRight]]) {
    const db = gainToDb(values?.peak ?? 0);
    $(`${id}Meter`).value = Math.max(-60, Math.min(0, db));
    $(`${id}Level`).textContent = db <= -96 ? "−∞ dBFS" : `${db.toFixed(1)} dBFS`;
  }
  const inputState = !audio.mic ? audio.active ? "Start the test, then speak or send audio." : "Turn Audio on, then test your input."
    : now < clippedUntil ? "Clipping detected — lower the input gain."
      : Math.max(level?.raw.peak ?? 0, level?.rawRight.peak ?? 0) < 0.001 ? "Listening — no input signal yet."
        : `Signal received.${audio.mic.monitoring ? " Monitoring on — use headphones." : ""}`;
  if (inputState !== lastInputState) {
    $("inputStatus").textContent = lastInputState = inputState;
    $("inputStatus").classList.toggle("is-clipping", Boolean(audio.mic && now < clippedUntil));
  }
  const currentTime = audio.context?.currentTime ?? 0;
  const playing = [...audio.sources].filter((source) => source.start <= currentTime && source.end > currentTime);
  for (const button of $("speakerMap").querySelectorAll("button")) button.classList.toggle("is-playing", playing.some((source) => source.channelIndex === Number(button.dataset.channel)));
  const channelIndex = playing[0]?.channelIndex;
  const channelState = !audio.active ? "Turn Audio on to hear the test."
    : channelIndex != null ? `OUT ${channelIndex + 1} · ${OUTPUT_LAYOUTS[prefs.layout][channelIndex].label}`
      : playing.length ? "“MIDI received” · front output"
        : audio.sources.size ? "Testing speakers…"
          : speakerCheckStarted ? "Test finished. Did you hear each channel?" : "Play a sound to check your speakers.";
  if (channelState !== lastChannelState) $("channelStatus").textContent = lastChannelState = channelState;
  $("midiActivity").classList.toggle("is-receiving", now - lastReceived < 180);
  $("midiCount").textContent = `${received} received`;
  $("midiBadge").textContent = midi.access ? received ? `${received} received` : "Listening" : "Off";
  $("midiLastMessage").hidden = messageLog.length === 0;
  if (messageLog.length) {
    const message = messageLog[0];
    $("midiLastMessage").textContent = `${message.channel ? `CH ${message.channel} · ` : ""}${message.text}`;
  }
  if (logDirty && now - lastLogPaint > 100) {
    $("midiLog").replaceChildren(...messageLog.map((message) => {
      const li = document.createElement("li");
      li.textContent = `${message.channel ? `CH ${message.channel} · ` : ""}${message.text}`;
      const small = document.createElement("small");
      small.textContent = `${message.hex} · ${message.name}`;
      li.append(small);
      return li;
    }));
    lastLogPaint = now;
    logDirty = false;
  }
}
// Native disclosures keep keyboard access and a no-JS fallback. Also enforce
// one open test in browsers without support for the details `name` attribute.
const testMenus = [...document.querySelectorAll(".io-test")];
for (const menu of testMenus) {
  menu.addEventListener("toggle", () => {
    if (menu.open) {
      for (const other of testMenus) if (other !== menu) other.open = false;
    } else if (menu.id === "inputTest") {
      audio.setMonitor(false);
      render();
    }
  });
}
$("inputOptions").addEventListener("toggle", () => {
  if (!$("inputOptions").open) { audio.setMonitor(false); render(); }
});
// Gear shortcuts open only the named test, without arming audio or devices.
function openLinkedTest({ focus = false } = {}) {
  const menu = testMenus.find((candidate) => `#${candidate.id}` === location.hash);
  if (!menu) return;
  for (const candidate of testMenus) candidate.open = candidate === menu;
  if (focus) menu.querySelector("summary").focus({ preventScroll: true });
}
openLinkedTest();
addEventListener("hashchange", () => openLinkedTest({ focus: true }));
document.addEventListener("click", (event) => {
  const link = event.target.closest?.(".header-settings-link");
  if (!link || new URL(link.href).hash !== location.hash) return;
  // Reusing the same shortcut should reopen a manually collapsed test too.
  openLinkedTest({ focus: true });
});
const meterTimer = setInterval(() => { if (!document.hidden) paintMeters(); }, 50);
const deviceChange = () => {
  audio.stopTests();
  audio.setMonitor(false);
  refreshDevices().then(render).catch(showError);
};
navigator.mediaDevices?.addEventListener("devicechange", deviceChange);
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") { event.preventDefault(); $("stopAll").click(); }
});
document.addEventListener("visibilitychange", () => {
  if (document.hidden) { audio.stopTests(); audio.setMonitor(false); midi.stopNote(); render(); }
});
addEventListener("pagehide", () => {
  disposed = true;
  sessionVersion++;
  micRequestVersion++;
  clearInterval(meterTimer);
  navigator.mediaDevices?.removeEventListener("devicechange", deviceChange);
  midi.disable();
  audio.disable().catch(() => {});
});
addEventListener("pageshow", (event) => { if (event.persisted) location.reload(); });
if (host) {
  $("hostNotice").hidden = false;
  $("refreshDevices").disabled = true;
} else refreshDevices().catch(showError);

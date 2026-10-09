import { SPARTIAL_DEFAULTS, SPARTIAL_SPECTRAL_PRESETS, sanitizeSpartialSettings, partialPosition, partialFrequencyRatio, randomSpartialSpectrum, randomSpartialInstrument, spartialCascadeTimes } from "./spartial.js";
import { SpartialAudio, spartialLayout, spartialSpeakers } from "./spartial-audio.js";
import { enhanceRangeKnob } from "../../ui/primitives/range-knob.js";

const $ = id => document.getElementById(id);
const TAU = Math.PI * 2;
const KEYS = ["a", "w", "s", "e", "d", "f", "t", "g", "y", "h", "u", "j", "k"];
const CHORDS = { minor: [0,3,7], major: [0,4,7], sus: [0,5,7], fifth: [0,7], minor7: [0,3,7,10], major7: [0,4,7,11] };
const NOTE_NAMES = ["C", "C♯", "D", "E♭", "E", "F", "F♯", "G", "A♭", "A", "B♭", "B"];
const PRESETS = [
  { id: "still", name: "Still harmonics", spectrum: "full", mode: "single", motion: "off" },
  { id: "halo", name: "Slow halo", spectrum: "soft", mode: "single", motion: "cw", beatsPerTurn: 32, attack: .5, release: 2.5, cascade: .06 },
  { id: "rise", name: "Ascending glass", spectrum: "bright", mode: "single", motion: "off", partials: 24, cascade: .065, cascadeCurve: -.45, attack: .015, release: .65 },
  { id: "fall", name: "Falling bells", spectrum: "bell", mode: "chord", chord: "fifth", motion: "off", cascadeOrder: "down", cascade: .08, cascadeCurve: .4, release: 2.2 },
  { id: "organ", name: "Wide organ", spectrum: "odd", mode: "chord", chord: "major", motion: "off", partials: 24, cascade: 0, attack: .02, release: .35 },
  { id: "hollow", name: "Hollow arc", spectrum: "hollow", mode: "single", motion: "off", cycles: .35, release: 1.8 },
  { id: "counter", name: "Counterpoint", spectrum: "full", mode: "chord", chord: "sus", motion: "counter", beatsPerTurn: 16, cascade: .02, pattern: "alternate" },
  { id: "squeeze", name: "Close cluster", spectrum: "cluster", mode: "single", motion: "off", cycles: .15, partials: 32, attack: .25 },
  { id: "double", name: "Double spiral", spectrum: "even", mode: "single", motion: "ccw", beatsPerTurn: 16, cycles: 2, partials: 32, cascade: .015 },
  { id: "scatter", name: "Scattered metal", spectrum: "bell", mode: "single", motion: "off", pattern: "scatter", partials: 24, cascadeOrder: "alternate", cascade: .045, cascadeVariation: .55 },
  { id: "soft", name: "Soft minor seven", spectrum: "soft", mode: "chord", chord: "minor7", motion: "off", attack: .65, release: 3, cascade: .01 },
  { id: "shimmer", name: "Expanded shimmer", spectrum: "bright", mode: "single", motion: "cw", beatsPerTurn: 64, stretch: 1.28, inharmonicity: .18, attack: .3, partials: 24 },
];
const state = {
  settings: sanitizeSpartialSettings(SPARTIAL_DEFAULTS), mode: "single", root: 48,
  chord: "minor", keyboardBase: 48, layout: "8-circle", forcePreview: false,
  audioOn: false, playing: false, holding: false, phase: 0, motion: "off", tempo: 90, beatsPerTurn: 16,
  routingMode: "spread", presetIndex: 0, spectrumIndex: 0, randomSeed: 173,
};
const held = new Map();
const downKeys = new Set();
let snapshot = null;
let disposed = false;
let frame = 0;
let previousFrameTime = performance.now();
let drag = null;
let geometry = null;
let routeInfo = null;
const canvas = $("stage");
const context = canvas.getContext("2d");
const tempoKnob = enhanceRangeKnob($("tempo"));
const audio = new SpartialAudio(
  next => { snapshot = next; state.phase = next.phase; },
  route => { routeInfo = route; updateRouteStatus(); },
  error => { state.audioOn = false; updateAudioButton(); announce(error, true); },
);
const color = index => `hsl(${(166 + index * 9) % 360} 64% 66%)`;
const noteName = note => `${NOTE_NAMES[((note % 12) + 12) % 12]}${Math.floor(note / 12) - 1}`;
const percent = value => `${Math.round(value * 100)}%`;
const millisecondSettings = new Set(["cascade", "cascadeStart"]);
const formats = {
  level: percent, partials: value => String(value), rolloff: value => value.toFixed(2),
  attack: value => `${Math.round(value * 1000)} ms`, release: value => `${value.toFixed(2)} s`,
  cascade: value => `${Math.round(value * 1000)} ms`, offset: value => `${Math.round(value * 360)}°`,
  cascadeStart: value => `${Math.round(value * 1000)} ms`,
  cascadeCurve: value => value === 0 ? "Even" : `${value < 0 ? "Faster" : "Slower"} at end · ${percent(Math.abs(value))}`,
  cascadeVariation: percent,
  cycles: value => `${value.toFixed(2)} ${value === 1 ? "turn" : "turns"}`,
  stretch: value => value === 1 ? "1.00 · harmonic" : `${value.toFixed(2)} · ${value < 1 ? "compressed" : "expanded"}`,
  inharmonicity: percent,
};
function announce(message, visible = false) {
  $("liveStatus").textContent = message;
  $("liveStatus").classList.toggle("sr-only", !visible);
}
function speakers() { return spartialSpeakers(spartialLayout(state.layout)); }
function updateRouteStatus() {
  $("routeBadge").textContent = !state.audioOn ? "Audio off" : routeInfo?.mode === "discrete" ? "Discrete surround" : "Stereo preview";
  if (!routeInfo) return;
  $("outputDetail").textContent = routeInfo.mode === "discrete"
    ? `${routeInfo.layout.speakers.length} discrete channels. Match the numbers to your interface patch. LFE is silent.`
    : `${routeInfo.capacity} output channels available. Stereo previews left/right only; surround needs a multichannel output.`;
}
function updateAudioButton() {
  $("audioButton").setAttribute("aria-pressed", String(state.audioOn));
  $("audioState").textContent = state.audioOn ? "on" : "off";
  updateRouteStatus();
}
function rotationRunning() { return state.playing && state.motion !== "off" && state.routingMode !== "focus"; }
function updatePerformance() {
  const rotating = rotationRunning();
  $("playButton").setAttribute("aria-pressed", String(rotating));
  $("playButton").setAttribute("aria-label", rotating ? "Pause rotation" : "Play rotation");
  $("playButton").title = rotating ? "Pause rotation" : "Play rotation";
  $("playButton").disabled = state.routingMode === "focus";
  const sound = state.mode === "chord" ? "chord" : "note";
  $("holdButton").setAttribute("aria-pressed", String(state.holding));
  $("holdButton").setAttribute("aria-label", `${state.holding ? "Release" : "Hold"} selected ${sound}`);
  $("holdButton").textContent = `${state.holding ? "Release" : "Hold"} ${sound}`;
  $("chord").disabled = state.mode !== "chord";
  $("spreadControls").hidden = state.routingMode === "focus";
  $("targetControl").hidden = state.routingMode !== "focus";
  $("motion").disabled = state.routingMode === "focus";
  $("beatsPerTurn").disabled = state.motion === "off" || state.routingMode === "focus";
  $("restartCascade").disabled = !state.holding;
  $("stageInstructions").textContent = state.routingMode === "focus"
    ? "Click a speaker to send all partials there. Drag around the ring to change speakers."
    : "Drag to turn the partials. Click a speaker to start there.";
  for (const button of $("notePads").children) {
    const index = Number(button.dataset.pad);
    button.setAttribute("aria-pressed", String(held.has(`pad:${index}`) || held.has(`key:${index}`)));
  }
}
function syncControls() {
  for (const [id, format] of Object.entries(formats)) {
    const value = millisecondSettings.has(id) ? Math.round(state.settings[id] * 1000) : state.settings[id];
    $(id).value = value;
    if (millisecondSettings.has(id) && document.activeElement !== $(`${id}Ms`)) $(`${id}Ms`).value = value;
    $(`${id}Out`).textContent = format(state.settings[id]);
  }
  for (const id of ["pattern", "cascadeOrder"]) $(id).value = state.settings[id];
  for (const id of ["mode", "root", "chord", "layout", "motion", "tempo", "beatsPerTurn", "routingMode"]) $(id).value = state[id];
  $("tempoOut").textContent = `${state.tempo} BPM`;
  $("tempo").setAttribute("aria-valuetext", `${state.tempo} BPM`);
  tempoKnob.update();
  $("forcePreview").checked = state.forcePreview;
  $("target").value = state.settings.target;
  for (const [index, bar] of [...$("partialSliders").children].entries()) {
    bar.title = `Partial ${index + 1}: ${partialFrequencyRatio(index, state.settings).toFixed(3)} × the played note`;
  }
  updateCascadeTiming();
  updatePerformance();
}
function updateCascadeTiming() {
  const times = spartialCascadeTimes(state.settings);
  const end = times.at(-1) ?? 0;
  $("cascadeDurationOut").textContent = `${Math.round(end * 1000)} ms`;
  $("cascadeTimeline").setAttribute("aria-label", `Scheduled partial entrances: first at ${Math.round(times[0] * 1000)} milliseconds, last at ${Math.round(end * 1000)} milliseconds. Silent partials also occupy a step.`);
  $("cascadeTimeline").replaceChildren(...times.map((time, index) => {
    const mark = document.createElement("span");
    mark.style.left = `${end > 0 ? time / end * 100 : 0}%`;
    mark.title = `Entrance ${index + 1}: ${Number((time * 1000).toFixed(2))} ms`;
    mark.setAttribute("aria-hidden", "true");
    return mark;
  }));
}
function customPreset(spectrum = false) {
  $("preset").value = "custom";
  if (spectrum) $("spectrumPreset").value = "custom";
}
function motionPatch() {
  const running = rotationRunning();
  return { rotation: running ? state.tempo / 60 / state.beatsPerTurn * (state.motion === "ccw" ? -1 : 1) : 0, counterRotate: state.motion === "counter" };
}
function patchSettings(patch) {
  const previousCount = state.settings.partials;
  state.settings = sanitizeSpartialSettings({ ...patch, ...motionPatch() }, state.settings);
  audio.settings(state.settings);
  if (previousCount !== state.settings.partials) buildSpectrum();
  syncControls();
}
function buildPatch() {
  const list = speakers();
  $("target").replaceChildren(...list.map((speaker, index) => {
    const option = document.createElement("option"); option.value = index;
    option.textContent = `${speaker.label} · channel ${speaker.channel}`; return option;
  }));
  $("speakerPatch").replaceChildren(...spartialLayout(state.layout).speakers.map(speaker => {
    const item = document.createElement("span"); item.textContent = `${speaker.channel} · ${speaker.label}`;
    item.title = speaker.kind === "lfe" ? "LFE channel — silent" : `Output channel ${speaker.channel}`; return item;
  }));
  patchSettings({ speakerCount: list.length, target: Math.min(state.settings.target, list.length - 1) });
}
function buildSpectrum() {
  $("partialSliders").replaceChildren(...Array.from({ length: state.settings.partials }, (_, index) => {
    const label = document.createElement("label"); label.className = "partial-bar";
    label.style.setProperty("--partial-color", color(index));
    const range = document.createElement("input"); range.type = "range"; range.min = "0"; range.max = "1"; range.step = "0.01";
    range.value = state.settings.gains[index]; range.setAttribute("aria-label", `Partial ${index + 1} level`);
    const caption = document.createElement("span"); caption.textContent = index + 1;
    range.addEventListener("input", () => {
      const gains = [...state.settings.gains]; gains[index] = Number(range.value);
      patchSettings({ gains }); customPreset(true);
    });
    label.append(range, caption); return label;
  }));
}
function releaseGroup(id) {
  const record = held.get(id); if (!record) return;
  record.notes.forEach((_, i) => audio.noteOff(`${id}:${i}`));
  held.delete(id); updatePerformance();
}
function playGroup(id, note, velocity = .8, exactNote = false) {
  releaseGroup(id);
  const notes = !exactNote && state.mode === "chord" ? CHORDS[state.chord].map(interval => note + interval) : [note];
  held.set(id, { notes, velocity });
  notes.forEach((pitch, i) => audio.noteOn(`${id}:${i}`, pitch, velocity));
  updatePerformance();
  if (!state.audioOn) announce("Audio is off — turn it on to hear playback", true);
}
function refreshLatch() { if (state.holding) playGroup("latch", state.root); }
function restartCascade() {
  if (!state.holding) return;
  const record = held.get("latch");
  if (!record) { refreshLatch(); return; }
  record.notes.forEach((note, index) => audio.retrigger(`latch:${index}`, note, record.velocity));
  if (!state.audioOn) announce("Audio is off — turn it on to hear playback", true);
}
function setPlaying(playing) {
  state.playing = playing;
  if (playing && state.motion === "off") { state.motion = "cw"; customPreset(); }
  patchSettings({});
}
function setHolding(holding) {
  state.holding = holding;
  if (holding) refreshLatch(); else releaseGroup("latch");
  if (!holding) announce("");
  updatePerformance();
}
function allNotesOff() {
  state.holding = false;
  for (const id of [...held.keys()]) releaseGroup(id);
  audio.panic(); downKeys.clear(); announce(""); updatePerformance();
}
function releaseManualNotes() {
  for (const id of [...held.keys()]) if (id !== "latch") releaseGroup(id);
  downKeys.clear(); drag = null;
}
function buildPads() {
  const blackPositions = { 1: 8.5, 3: 21, 6: 46, 8: 58.5, 10: 71 };
  $("notePads").replaceChildren(...Array.from({ length: 13 }, (_, index) => {
    const button = document.createElement("button"); button.type = "button"; button.dataset.pad = index;
    button.setAttribute("aria-label", `Play ${noteName(state.keyboardBase + index)} · ${KEYS[index].toUpperCase()} key`);
    button.setAttribute("aria-pressed", "false");
    if (index in blackPositions) { button.className = "black-key"; button.style.left = `${blackPositions[index]}%`; }
    const label = document.createElement("span"); label.textContent = NOTE_NAMES[index % 12];
    const key = document.createElement("kbd"); key.textContent = KEYS[index].toUpperCase(); button.append(label, key);
    const press = () => playGroup(`pad:${index}`, state.keyboardBase + index);
    button.addEventListener("pointerdown", event => {
      if (event.button !== 0) return;
      event.preventDefault(); button.setPointerCapture(event.pointerId); press();
    });
    for (const type of ["pointerup", "pointercancel", "lostpointercapture"]) button.addEventListener(type, () => releaseGroup(`pad:${index}`));
    button.addEventListener("keydown", event => {
      if ([" ", "Enter"].includes(event.key) && !event.repeat) { event.preventDefault(); press(); }
    });
    button.addEventListener("keyup", event => {
      if ([" ", "Enter"].includes(event.key)) { event.preventDefault(); releaseGroup(`pad:${index}`); }
    });
    button.addEventListener("blur", () => releaseGroup(`pad:${index}`));
    button.addEventListener("click", event => {
      if (event.detail === 0 && !downKeys.size) {
        if (held.has(`pad:${index}`)) releaseGroup(`pad:${index}`); else press();
      }
    });
    return button;
  }));
  $("notePads").setAttribute("aria-label", `Chromatic keyboard ${noteName(state.keyboardBase)} to ${noteName(state.keyboardBase + 12)}`);
  $("octaveDown").disabled = state.keyboardBase <= 24;
  $("octaveUp").disabled = state.keyboardBase >= 72;
  updatePerformance();
}
function spectralPreset(id) { return SPARTIAL_SPECTRAL_PRESETS.find(preset => preset.id === id) ?? SPARTIAL_SPECTRAL_PRESETS[0]; }
function applyPreset(index) {
  state.presetIndex = (index + PRESETS.length) % PRESETS.length;
  const preset = PRESETS[state.presetIndex];
  const level = state.settings.level;
  state.mode = preset.mode; state.chord = preset.chord ?? "minor";
  state.motion = preset.motion; state.beatsPerTurn = preset.beatsPerTurn ?? 16;
  state.routingMode = "spread";
  state.settings = sanitizeSpartialSettings({ ...SPARTIAL_DEFAULTS, ...spectralPreset(preset.spectrum).settings, ...preset, level, speakerCount: speakers().length });
  patchSettings({}); buildSpectrum(); refreshLatch();
  $("preset").value = preset.id;
  state.spectrumIndex = SPARTIAL_SPECTRAL_PRESETS.findIndex(item => item.id === preset.spectrum);
  $("spectrumPreset").value = preset.spectrum;
}
function applySpectrum(index) {
  state.spectrumIndex = (index + SPARTIAL_SPECTRAL_PRESETS.length) % SPARTIAL_SPECTRAL_PRESETS.length;
  const preset = SPARTIAL_SPECTRAL_PRESETS[state.spectrumIndex];
  patchSettings(preset.settings); buildSpectrum(); customPreset(); $("spectrumPreset").value = preset.id;
}
function randomSpectrum() {
  state.randomSeed += 97; patchSettings(randomSpartialSpectrum(state.randomSeed));
  buildSpectrum(); customPreset(true);
}
function randomInstrument() {
  state.randomSeed += 101;
  Object.assign(state, randomSpartialInstrument(state, state.randomSeed));
  patchSettings({});
  buildSpectrum(); refreshLatch(); customPreset(true);
}
function populateSelect(element, items) {
  element.replaceChildren(...items.map(({ id, name }) => {
    const option = document.createElement("option"); option.value = id; option.textContent = name; return option;
  }));
  const custom = document.createElement("option"); custom.value = "custom"; custom.textContent = "Custom"; custom.disabled = true; element.append(custom);
}
populateSelect($("preset"), PRESETS); populateSelect($("spectrumPreset"), SPARTIAL_SPECTRAL_PRESETS);
for (let note = 24; note <= 84; note += 1) {
  const option = document.createElement("option"); option.value = note; option.textContent = noteName(note); $("root").append(option);
}
for (const id of Object.keys(formats)) $(id).addEventListener("input", () => {
  patchSettings({ [id]: Number($(id).value) / (millisecondSettings.has(id) ? 1000 : 1) });
  if (id !== "level") customPreset(["stretch","inharmonicity","rolloff"].includes(id));
});
for (const id of millisecondSettings) {
  const input = $(`${id}Ms`);
  input.addEventListener("input", () => {
    const value = input.valueAsNumber;
    if (!Number.isFinite(value) || value < Number(input.min) || value > Number(input.max)) return;
    patchSettings({ [id]: Math.round(value) / 1000 }); customPreset();
  });
  input.addEventListener("change", () => {
    const value = input.valueAsNumber;
    input.value = Math.round(Number.isFinite(value) ? Math.max(Number(input.min), Math.min(Number(input.max), value)) : state.settings[id] * 1000);
    patchSettings({ [id]: Number(input.value) / 1000 }); customPreset();
  });
}
for (const id of ["pattern", "cascadeOrder"]) $(id).addEventListener("change", () => { patchSettings({ [id]: $(id).value }); customPreset(); });
$("tempo").addEventListener("input", () => {
  state.tempo = Math.max(30, Math.min(240, Math.round(Number($("tempo").value) || 90)));
  patchSettings({});
});
for (const id of ["beatsPerTurn", "motion"]) $(id).addEventListener("change", () => {
  state[id] = id === "motion" ? $(id).value : Math.max(4, Math.min(64, Number($(id).value) || 16));
  patchSettings({}); customPreset();
});
for (const id of ["mode", "root", "chord"]) $(id).addEventListener("change", () => {
  state[id] = id === "root" ? Number($(id).value) : $(id).value;
  releaseManualNotes();
  if (id === "root") { state.keyboardBase = Math.min(72, Math.floor(state.root / 12) * 12); buildPads(); }
  refreshLatch(); syncControls(); customPreset();
});
for (const [id, direction] of [["octaveDown", -1], ["octaveUp", 1]]) $(id).addEventListener("click", () => {
  releaseManualNotes(); state.keyboardBase = Math.max(24, Math.min(72, state.keyboardBase + direction * 12)); buildPads();
});
$("preset").addEventListener("change", () => applyPreset(PRESETS.findIndex(item => item.id === $("preset").value)));
$("nextPreset").addEventListener("click", () => applyPreset(state.presetIndex + 1));
$("randomPreset").addEventListener("click", randomInstrument);
$("spectrumPreset").addEventListener("change", () => applySpectrum(SPARTIAL_SPECTRAL_PRESETS.findIndex(item => item.id === $("spectrumPreset").value)));
$("nextSpectrum").addEventListener("click", () => applySpectrum(state.spectrumIndex + 1));
$("randomSpectrum").addEventListener("click", randomSpectrum);
$("routingMode").addEventListener("change", () => {
  state.routingMode = $("routingMode").value; patchSettings({ lock: state.routingMode === "focus" ? 1 : 0 }); customPreset();
});
$("target").addEventListener("change", () => { patchSettings({ target: Number($("target").value) }); customPreset(); });
$("layout").addEventListener("change", () => { state.layout = $("layout").value; buildPatch(); audio.route(state.layout, state.forcePreview); });
$("forcePreview").addEventListener("change", () => { state.forcePreview = $("forcePreview").checked; audio.route(state.layout, state.forcePreview); });
$("playButton").addEventListener("click", () => setPlaying(!rotationRunning()));
$("holdButton").addEventListener("click", () => setHolding(!state.holding));
$("restartCascade").addEventListener("click", restartCascade);
$("panicButton").addEventListener("click", allNotesOff);
$("resetAll").addEventListener("click", () => {
  state.root = 48; state.keyboardBase = 48; state.tempo = 90; state.phase = 0;
  releaseManualNotes(); applyPreset(0); audio.setPhase(0); snapshot = null; buildPads(); syncControls();
});
$("audioButton").addEventListener("click", async () => {
  if (state.audioOn) {
    state.audioOn = false; audio.disable(); updateAudioButton();
    if (held.size) announce("Audio is off — turn it on to hear playback", true); return;
  }
  $("audioButton").disabled = true; $("audioState").textContent = "starting";
  const firstStart = !audio.node;
  try {
    await audio.start(state.settings, state.layout, state.forcePreview, state.phase);
    if (disposed) return;
    state.audioOn = true; updateAudioButton();
    audio.settings(state.settings); audio.route(state.layout, state.forcePreview);
    if (firstStart) for (const [id, record] of held) record.notes.forEach((note, index) => audio.noteOn(`${id}:${index}`, note, record.velocity));
    announce("");
  } catch (error) { $("audioState").textContent = "error"; announce(`Audio could not start: ${error.message}`, true); }
  finally { $("audioButton").disabled = false; }
});
function isEditing(target) { return target?.closest?.("input, select, textarea, button, a, summary, [contenteditable='true'], [role='slider']"); }
document.addEventListener("keydown", event => {
  if (event.defaultPrevented || event.isComposing || event.repeat || event.ctrlKey || event.metaKey || event.altKey || isEditing(event.target)) return;
  const index = KEYS.indexOf(event.key.toLowerCase()); if (index < 0) return;
  event.preventDefault(); downKeys.add(index); playGroup(`key:${index}`, state.keyboardBase + index);
});
document.addEventListener("keyup", event => {
  const index = KEYS.indexOf(event.key.toLowerCase()); if (index < 0) return;
  downKeys.delete(index); releaseGroup(`key:${index}`);
});
window.addEventListener("blur", () => { releaseManualNotes(); tempoKnob.cancelGesture(); });
document.addEventListener("visibilitychange", () => { if (document.hidden) releaseManualNotes(); });
window.addEventListener("morphazoid:midi-input", event => {
  const { routeId, message } = event.detail ?? {}; if (routeId !== "spartial" || !message) return;
  if (message.type === "noteOn" || message.type === "noteOff") {
    event.preventDefault(); const id = `midi:${message.sourceId ?? "default"}:${message.channel ?? 0}:${message.note}`;
    if (message.type === "noteOn" && message.velocity > 0) playGroup(id, message.note, message.velocity / 127, true); else releaseGroup(id);
  } else if (message.type === "controlChange" && [120,123].includes(message.controller)) {
    event.preventDefault();
    const prefix = message.synthetic && message.sourceId === "web-midi:manager" ? "midi:" : `midi:${message.sourceId ?? "default"}:${message.synthetic ? "" : `${message.channel ?? 0}:`}`;
    for (const id of [...held.keys()]) if (id.startsWith(prefix)) releaseGroup(id);
  }
});
function canvasPoint(event) { const rect = canvas.getBoundingClientRect(); return { x: event.clientX - rect.left, y: event.clientY - rect.top }; }
function pointAngle(point) { return (Math.atan2(point.x - geometry.cx, geometry.cy - point.y) / TAU + 1) % 1; }
function focusPoint(point) {
  if (Math.hypot(point.x - geometry.cx, point.y - geometry.cy) < geometry.radius * .25) return;
  patchSettings({ target: Math.round(pointAngle(point) * speakers().length) % speakers().length }); customPreset();
}
canvas.addEventListener("pointerdown", event => {
  if (event.button !== 0 || !geometry) return;
  canvas.focus(); const point = canvasPoint(event);
  if (state.routingMode === "focus") {
    focusPoint(point); drag = { mode: "focus" }; canvas.setPointerCapture(event.pointerId); return;
  }
  const target = geometry.speakers.findIndex(speaker => Math.hypot(speaker.x - point.x, speaker.y - point.y) < 24);
  if (target >= 0) { patchSettings({ offset: (target / speakers().length - state.phase + 1) % 1 }); customPreset(); return; }
  if (Math.hypot(point.x - geometry.cx, point.y - geometry.cy) < 18) return;
  canvas.setPointerCapture(event.pointerId); drag = { mode: "spread", angle: pointAngle(point), offset: state.settings.offset };
});
canvas.addEventListener("pointermove", event => {
  if (!drag || !geometry) return; const point = canvasPoint(event);
  if (drag.mode === "focus") focusPoint(point);
  else { patchSettings({ offset: ((drag.offset + pointAngle(point) - drag.angle) % 1 + 1) % 1 }); customPreset(); }
});
for (const type of ["pointerup", "pointercancel", "lostpointercapture"]) canvas.addEventListener(type, () => { drag = null; });
canvas.addEventListener("keydown", event => {
  if (!["ArrowLeft","ArrowRight","ArrowUp","ArrowDown"].includes(event.key)) return;
  event.preventDefault(); const direction = ["ArrowLeft","ArrowDown"].includes(event.key) ? -1 : 1;
  if (state.routingMode === "focus") patchSettings({ target: (state.settings.target + direction + speakers().length) % speakers().length });
  else if (["ArrowLeft","ArrowRight"].includes(event.key)) patchSettings({ offset: (state.settings.offset + direction * .025 + 1) % 1 });
  else patchSettings({ cycles: state.settings.cycles + direction * .05 });
  customPreset();
});
function draw(now) {
  if (disposed) return;
  const elapsed = Math.min(.1, (now - previousFrameTime) / 1000); previousFrameTime = now;
  if (!audio.node) state.phase = (state.phase + state.settings.rotation * elapsed + 1) % 1;
  const rect = canvas.getBoundingClientRect(); const dpr = Math.min(2, devicePixelRatio || 1);
  if (canvas.width !== Math.round(rect.width * dpr) || canvas.height !== Math.round(rect.height * dpr)) { canvas.width = Math.round(rect.width * dpr); canvas.height = Math.round(rect.height * dpr); }
  context.setTransform(dpr,0,0,dpr,0,0); context.clearRect(0,0,rect.width,rect.height);
  const cx = rect.width / 2; const cy = rect.height / 2; const radius = Math.min(rect.width * .37, rect.height * .34);
  const list = speakers(); const points = list.map((speaker,index) => ({ x: cx + Math.sin(index / list.length * TAU) * radius, y: cy - Math.cos(index / list.length * TAU) * radius, speaker }));
  geometry = { cx,cy,radius,speakers: points };
  context.strokeStyle = "rgba(137,171,160,.18)"; context.lineWidth = 1;
  for (const r of [radius, radius * .76]) { context.beginPath(); context.arc(cx,cy,r,0,TAU); context.stroke(); }
  const levels = new Float32Array(list.length);
  for (let index = 0; index < state.settings.partials; index += 1) {
    const position = snapshot?.positions?.[index] ?? partialPosition(index,state.settings,state.phase);
    const energy = state.audioOn ? snapshot?.partialEnergy?.[index] ?? 0 : 0;
    const left = Math.floor(position) % list.length; const blend = position - Math.floor(position);
    levels[left] += energy * Math.cos(blend * Math.PI / 2); levels[(left + 1) % list.length] += energy * Math.sin(blend * Math.PI / 2);
    if (state.routingMode === "focus") continue;
    const angle = position / list.length * TAU;
    const track = Math.floor(index * state.settings.cycles / state.settings.partials);
    const r = radius * .76 - track * 11;
    const x = cx + Math.sin(angle) * r; const y = cy - Math.cos(angle) * r;
    context.globalAlpha = state.settings.gains[index] > 0 ? energy > .00001 ? .95 : .45 : .1;
    context.fillStyle = color(index); context.beginPath(); context.arc(x,y,3.5 + Math.min(3, energy * 35),0,TAU); context.fill();
    if (state.settings.partials <= 16) { context.font = "9px monospace"; context.textAlign = "center"; context.fillText(index + 1, cx + Math.sin(angle) * (r - 15), cy - Math.cos(angle) * (r - 15) + 3); }
  }
  context.globalAlpha = 1;
  points.forEach(({x,y,speaker},index) => {
    const focus = state.routingMode === "focus" && index === state.settings.target;
    const strength = Math.min(1,levels[index] * 5);
    context.fillStyle = focus ? "#384636" : "#0f1716";
    context.strokeStyle = focus ? "#e8c46b" : `rgba(133,212,184,${.35 + strength * .65})`;
    context.lineWidth = focus ? 2 : 1;
    context.beginPath(); context.roundRect(x - 19,y - 19,38,38,2); context.fill(); context.stroke();
    context.fillStyle = focus ? "#f1d69a" : "#c9ded5"; context.font = "11px monospace"; context.textAlign = "center"; context.textBaseline = "middle";
    context.fillText(String(speaker.channel),x,y);
    context.fillStyle = "#849c92"; context.font = "9px monospace";
    context.fillText(speaker.label, x + (x - cx) * .24, y + (y - cy) * .24);
    if (focus) {
      context.fillStyle = "#e8c46b";
      context.beginPath(); context.arc(cx + (x - cx) * .76,cy + (y - cy) * .76,8 + strength * 5,0,TAU); context.fill();
    }
  });
  context.textAlign = "left"; context.textBaseline = "alphabetic";
  frame = requestAnimationFrame(draw);
}

buildPatch(); buildSpectrum(); buildPads(); syncControls(); updateAudioButton();
frame = requestAnimationFrame(draw);
window.addEventListener("pagehide", event => {
  tempoKnob.cancelGesture();
  if (event.persisted) {
    releaseManualNotes(); audio.disable(); state.audioOn = false; updateAudioButton(); cancelAnimationFrame(frame); void audio.context?.suspend(); return;
  }
  disposed = true; cancelAnimationFrame(frame); held.clear(); downKeys.clear(); audio.dispose(); tempoKnob.destroy();
});
window.addEventListener("pageshow", event => {
  if (event.persisted && !disposed) {
    previousFrameTime = performance.now(); frame = requestAnimationFrame(draw);
    if (state.holding) announce("Audio is off — turn it on to hear playback", true);
  }
});

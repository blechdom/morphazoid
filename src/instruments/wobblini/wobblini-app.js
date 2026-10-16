import { createAudioStrip } from "../../ui/patterns/audio-strip.js";
import { enhanceRangeKnob } from "../../ui/primitives/range-knob.js";
import { WobbliniAudio } from "./wobblini-audio.js";

const $ = (id) => document.getElementById(id);
const abort = new AbortController();
const on = (node, type, fn, options = {}) => node.addEventListener(type, fn, { ...options, signal: abort.signal });
const colors = ["#c5f078", "#75dfc7", "#76c6f3", "#f1ca78", "#c6a2fa", "#fa9fb8", "#f6ae81", "#91b6fa"];
let initialized = false, disposed = false, starting = false, audioAttempt = 0, frame = 0, lastDraw = 0;
let view = "records", leftDeck = 0, rightDeck = 1, confirmation = null, padPointer = null;
const isRecordView = () => view === "records" || view === "classic";
const cueReleases = new Set();
let settingsDeck = null;
// Safari does not expose deviceMemory. Coarse input selects the conservative
// budget on iPhones/iPads too, without guessing their model from a user agent.
const constrained = matchMedia("(any-pointer: coarse)").matches || navigator.deviceMemory <= 4 || navigator.hardwareConcurrency <= 4;
const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)");
const drawInterval = 1000 / (constrained ? 20 : 30), pixelRatioLimit = constrained ? 1 : 2;
let renderPending = false, lastReadout = 0, lastSyncWarning = "";
const seeking = new Set();
export const engine = new WobbliniAudio({ resourceProfile: constrained ? "constrained" : "standard", onChange: () => { if (initialized) renderPending = true; }, onError: showError });
const initial = engine.getState();
const strip = createAudioStrip({ buttonId: "audioButton", levelId: "level", level: initial.master.gain,
  min: 0, max: 1, step: 0.01, onAudioClick: toggleAudio, onLevelInput: (gain) => engine.setMaster({ gain }) });
$("audioSlot").replaceWith(strip);

const icons = {
  play: '<path d="m9 5 11 7-11 7Z" fill="currentColor" stroke="none"/>',
  pause: '<path d="M8 5v14M16 5v14" stroke-width="4"/>',
  stop: '<rect x="6" y="6" width="12" height="12" rx="1" fill="currentColor" stroke="none"/>',
  record: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="3"/><path d="M5 9a8 8 0 0 1 4-4m10 10a8 8 0 0 1-4 4"/>',
  classic: '<circle cx="6" cy="12" r="5"/><circle cx="18" cy="12" r="5"/><path d="M6 10v4m12-4v4"/>',
  waveform: '<path d="M2 7h2l2-4 3 8 3-6 2 4 2-2h6M2 17h3l2-3 3 7 3-9 3 8 2-3h4"/>',
  prepare: '<path d="M3 4h18M3 20h18M2 12h4l2-5 4 10 3-7 3 2h4"/>',
  keylock: '<path d="M4 15V5l8-2v10"/><ellipse cx="2.8" cy="15" rx="2" ry="2"/><rect x="13" y="13" width="9" height="8" rx="1"/><path d="M15 13v-3a2.5 2.5 0 0 1 5 0v3"/>',
  slip: '<path d="M4 8a8 8 0 1 1-1 7M4 3v5h5m3-2v6l4 2"/>',
  sliders: '<path d="M5 3v18M12 3v18M19 3v18"/><path d="M2 8h6m1 8h6m1-10h6" stroke-width="4"/>',
  grid: '<path d="M3 5h3v4H3zm5 0h3v4H8zm5 0h3v4h-3zm5 0h3v4h-3zM3 15h3v4H3zm5 0h3v4H8zm5 0h3v4h-3zm5 0h3v4h-3z" fill="currentColor" stroke="none"/>',
  help: '<circle cx="12" cy="12" r="9"/><path d="M9 9a3 3 0 1 1 5 2c-1 .7-2 1-2 3m0 3v.1"/>',
  load: '<path d="M12 16V3m-5 5 5-5 5 5M4 14v6h16v-6"/>',
  cue: '<path d="M6 5v14m12-14L8 12l10 7Z"/>',
  setcue: '<path d="M5 21V3h11l-3 4 3 4H5m13 4v6m-3-3h6"/>',
  mute: '<path d="M11 4 6 8H3v8h3l5 4Zm5 5 6 6m0-6-6 6"/>',
  solo: '<path d="M4 15v-3a8 8 0 0 1 16 0v3M4 13h3v7H4zm13 0h3v7h-3z"/>',
  music: '<path d="M9 18V5l11-2v13M9 8l11-2"/><ellipse cx="6" cy="18" rx="3" ry="2"/><ellipse cx="17" cy="16" rx="3" ry="2"/>',
  reset: '<path d="M4 9a8 8 0 1 1 0 7M4 3v6h6"/>',
  center: '<path d="M12 3v18M2 12h6m-3-3 3 3-3 3m17-3h-6m3-3-3 3 3 3"/>',
  dry: '<path d="M3 12h18M5 5l14 14"/>',
  close: '<path d="m6 6 12 12M6 18 18 6"/>',
  check: '<path d="m4 12 5 5L20 6"/>',
  crown: '<path d="m3 6 4 4 5-6 5 6 4-4-2 12H5ZM5 21h14"/>',
  gear: '<path d="m10 3-.6 3-2 .9-2.7-1-2 3.5 2.2 2v2.2l-2.2 2 2 3.5 2.7-1 2 .9.6 3h4l.6-3 2-.9 2.7 1 2-3.5-2.2-2v-2.2l2.2-2-2-3.5-2.7 1-2-.9L14 3Z"/><circle cx="12" cy="12" r="3"/>',
};
const icon = (name) => `<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">${icons[name]}</svg>`;
function setIcon(node, name, label) {
  if (node.dataset.renderedIcon !== name) { node.innerHTML = icon(name); node.dataset.renderedIcon = name; }
  if (label) { node.setAttribute("aria-label", label); node.title = label; }
  else if (!node.title) node.title = node.getAttribute("aria-label") || "";
}
for (const node of document.querySelectorAll("[data-icon]")) setIcon(node, node.dataset.icon);
const range = (i, key, label, min, max, step, value) => `<label class="wb-control" for="d${i}${key}"><span>${label}<output id="d${i}${key}Out" for="d${i}${key}"></output></span><input id="d${i}${key}" type="range" min="${min}" max="${max}" step="${step}" value="${value}" aria-label="Deck ${i + 1} ${label}" /></label>`;
const cards = Array.from({ length: 8 }, (_, i) => {
  const deck = document.createElement("section");
  deck.className = "wb-deck"; deck.id = `deck${i}`; deck.dataset.deck = i;
  deck.style.setProperty("--deck-color", colors[i]); deck.style.setProperty("--accent", colors[i]); deck.setAttribute("aria-label", `Deck ${i + 1}`);
  deck.innerHTML = `<div class="wb-deck-identity"><div class="wb-deck-heading"><span class="wb-deck-number" aria-hidden="true">${i + 1}</span><button id="d${i}Master" class="wb-master-select" type="button" aria-label="Make deck ${i + 1} the tempo master" aria-pressed="${i === 0}" title="Make deck ${i + 1} the tempo master">${icon("crown")}</button></div><button id="d${i}Sync" class="wb-track-sync" type="button" aria-label="Sync deck ${i + 1} to the master" aria-pressed="false">SYNC</button></div><span id="d${i}SyncStatus" class="sr-only"></span><span id="d${i}Name" class="wb-source-name">Demo source</span><span id="d${i}Kind" class="wb-source-status">Original demo</span><input id="d${i}File" type="file" accept="audio/*,.wav,.mp3,.m4a,.aac,.ogg,.flac,.aiff" hidden />
    <div class="wb-visual"><div id="d${i}Platter" class="wb-disc" role="slider" tabindex="0" aria-label="Scratch deck ${i + 1}" aria-valuemin="0" aria-valuemax="8" aria-valuenow="0" aria-describedby="scratchHelp d${i}Name d${i}Kind d${i}SyncStatus"><div class="wb-record-clip"><div class="wb-record-surface"><canvas id="d${i}RecordWave" class="wb-record-wave" aria-hidden="true"></canvas></div></div><i class="wb-disc-needle" aria-hidden="true"></i></div><div class="wb-wave-wrap"><canvas id="d${i}Wave" class="wb-wave" role="slider" tabindex="0" aria-valuemin="0" aria-valuemax="8" aria-valuenow="0" aria-label="Scratch deck ${i + 1} waveform" aria-describedby="scratchHelp">Audio waveform.</canvas><div class="wb-time"><output id="d${i}Time">0:00.0</output><output id="d${i}Duration">0:08</output></div></div></div>
    <input id="d${i}Seek" class="wb-seek" type="range" min="0" max="8" step="0.01" value="0" aria-label="Deck ${i + 1} position in seconds" />
    <div class="wb-deck-transport"><button id="d${i}Play" class="wb-deck-play" type="button" aria-label="Play deck ${i + 1}" aria-pressed="false" title="Play deck ${i + 1}">${icon("play")}</button><button id="d${i}Cue" class="wb-cue" type="button" aria-label="Return to cue on deck ${i + 1}" title="Return to cue">${icon("cue")}</button><button id="d${i}SetCue" class="wb-set-cue" type="button" aria-label="Set cue on deck ${i + 1}" title="Set cue">${icon("setcue")}</button></div>
    <div class="wb-tempo-row"><output class="wb-effective" id="d${i}Effective">120.0 <small>BPM</small></output><label for="d${i}Assignment">Crossfader<select id="d${i}Assignment" aria-label="Deck ${i + 1} crossfader assignment"><option value="A">A</option><option value="THRU">Thru</option><option value="B">B</option></select></label></div>
    <div class="wb-level-row"><label for="d${i}Gain"><span>LEVEL <output id="d${i}GainOut" for="d${i}Gain">65%</output></span><input id="d${i}Gain" type="range" min="0" max="1" step="0.01" value="0.65" aria-label="Deck ${i + 1} level" /></label><button id="d${i}Mute" type="button" aria-label="Mute deck ${i + 1}" aria-pressed="false" title="Mute deck ${i + 1}">M</button><button id="d${i}Solo" class="wb-solo" type="button" aria-label="Solo deck ${i + 1}" aria-pressed="false" title="Solo deck ${i + 1}">S</button></div>
    <div class="wb-footer"><div class="wb-footer-actions"><button id="d${i}Load" class="wb-load" type="button" aria-label="Load audio into deck ${i + 1}" title="Load audio">${icon("load")}</button><button id="d${i}Edit" class="wb-edit" type="button" aria-expanded="false" aria-controls="d${i}Details" aria-label="Edit deck ${i + 1}" title="Edit deck ${i + 1}">${icon("sliders")}</button></div></div>
    <details id="d${i}Details" class="wb-detail"><summary aria-label="Tempo, EQ and filter" title="Tempo, EQ and filter">${icon("sliders")}</summary><div class="wb-detail-body"><div class="wb-source-tempo"><label for="d${i}Bpm">Source BPM<input id="d${i}Bpm" class="deck-bpm" type="number" min="40" max="240" step="0.1" value="120" aria-label="Deck ${i + 1} source BPM" /></label></div>
    <label class="wb-field" for="d${i}TempoRange">Speed range<select id="d${i}TempoRange" aria-label="Deck ${i + 1} speed range">${[8, 10, 16, 25, 50, 75].map(n => `<option value="${n}">±${n}%</option>`).join("")}</select></label>
    ${range(i, "Rate", "Speed", .92, 1.08, .001, 1)}
    ${range(i, "Pitch", "Pitch", -12, 12, 1, 0)}
    <div class="wb-deck-options"><button id="d${i}SpeedReset" type="button" aria-label="Reset deck ${i + 1} speed" title="Reset speed">${icon("reset")}</button><button id="d${i}PitchReset" type="button" aria-label="Reset deck ${i + 1} pitch" title="Reset pitch">${icon("music")}</button><button id="d${i}KeyLock" type="button" aria-pressed="true" aria-label="Preserve pitch on deck ${i + 1}" title="Key Lock">${icon("keylock")}</button><button id="d${i}Slip" type="button" aria-pressed="false" aria-label="Slip on deck ${i + 1}" title="Slip">${icon("slip")}</button></div>
    ${range(i, "Trim", "Gain", -24, 12, .5, 0)}
    <label class="wb-auto-gain"><input id="d${i}AutoGain" type="checkbox" aria-label="Deck ${i + 1} automatic gain matching" />Auto Gain <output id="d${i}AutoGainOut"></output></label>
    <label class="wb-field" for="d${i}BeatOffset">First beat (s)<input id="d${i}BeatOffset" type="number" min="0" step=".001" value="0" aria-label="Deck ${i + 1} first beat in seconds" /></label>
    <div class="wb-eq">${["Low", "Mid", "High"].map((name) => range(i, name, name, -24, 12, 0.5, 0)).join("")}</div>
    ${range(i, "Filter", "Filter · low ↔ high", -1, 1, 0.01, 0)}
    ${range(i, "Pan", "Pan · left ↔ right", -1, 1, 0.01, 0)}
    </div></details>`;
  $("deckGrid").append(deck);
  // Keep the same native controls, IDs and listeners in every view.
  const corners = document.createElement("div");
  corners.className = "wb-record-corners";
  corners.innerHTML = `<div class="wb-corner-mix"></div><label class="wb-record-volume" title="Deck ${i + 1} volume"><input id="d${i}RecordGain" type="range" min="0" max="1" step="0.01" value="0.65" aria-label="Deck ${i + 1} platter volume" /></label>`;
  deck.append(corners);
  const recordGain = enhanceRangeKnob($(`d${i}RecordGain`));
  on($(`d${i}RecordGain`), "input", event => engine.setDeck(i, { gain: event.target.valueAsNumber }));
  on($(`d${i}Master`), "click", () => act(() => engine.setMasterDeck(i)));
  on($(`d${i}Sync`), "click", () => act(() => engine.setDeckSyncEnabled(i, !engine.getDeckState(i).syncEnabled)));
  const cornerControls = ["Edit", "Solo", "Mute"].map((name) => {
    const button = $("d" + i + name), home = document.createComment(name + " control");
    button.before(home); button.classList.add("wb-corner-" + name.toLowerCase());
    return { button, home };
  });
  const placeControls = (records) => {
    for (const { button, home } of cornerControls) {
      if (records) (button.classList.contains("wb-corner-edit") ? corners : corners.querySelector(".wb-corner-mix")).append(button); else home.after(button);
    }
  };
  placeControls(true);
  // Keep a keyboard-held Cue focused until Play tells the engine to continue.
  on($(`d${i}Play`), "pointerdown", event => { if (engine.getDeckState(i).cuePreviewing) event.preventDefault(); });
  on($(`d${i}Play`), "click", () => act(() => engine.toggle(i)));
  const releaseCue = bindCue($(`d${i}Cue`), () => i);
  on($(`d${i}SetCue`), "click", () => { engine.setCue(i); say(`Deck ${i + 1} cue saved at ${time(engine.getDeckState(i).cuePoint)}.`); });
  on($("d" + i + "Load"), "click", () => $("d" + i + "File").click());
  on($(`d${i}File`), "change", (event) => { const file = event.target.files[0]; event.target.value = ""; if (file) act(() => importFile(i, file)); });
  on($(`d${i}Seek`), "input", (event) => act(() => engine.seek(i, Number(event.target.value))));
  on($(`d${i}Seek`), "pointerdown", () => seeking.add(i));
  for (const type of ["pointerup", "pointercancel", "blur"]) on($(`d${i}Seek`), type, () => seeking.delete(i));
  for (const [key, field] of [["Gain", "gain"], ["Rate", "rate"], ["Bpm", "bpm"], ["Filter", "filter"], ["Pan", "pan"], ["Trim", "trimDb"], ["Pitch", "pitchSemitones"], ["BeatOffset", "beatOffset"]]) {
    on($(`d${i}${key}`), "input", (event) => { if (event.target.value !== "" && Number.isFinite(event.target.valueAsNumber)) act(() => engine.setDeck(i, { [field]: event.target.valueAsNumber })); });
    on($(`d${i}${key}`), "change", () => { cards[i].renderKey = null; render(); });
    on($(`d${i}${key}`), "blur", () => { cards[i].renderKey = null; render(); });
  }
  on($(`d${i}Assignment`), "change", event => engine.setDeck(i, { assignment: event.target.value }));
  on($(`d${i}TempoRange`), "change", event => engine.setDeck(i, { tempoRange: Number(event.target.value) }));
  on($(`d${i}AutoGain`), "change", event => engine.setDeck(i, { autoGain: event.target.checked }));
  on($(`d${i}SpeedReset`), "click", () => act(() => engine.setDeck(i, { rate: 1 })));
  on($(`d${i}PitchReset`), "click", () => act(() => engine.setDeck(i, { pitchSemitones: 0 })));
  for (const [button, field] of [["KeyLock", "keyLock"], ["Slip", "slipEnabled"]]) {
    on($(`d${i}${button}`), "click", () => act(() => engine.setDeck(i, { [field]: !engine.getDeckState(i)[field] })));
  }
  for (const key of ["Low", "Mid", "High"]) on($(`d${i}${key}`), "input", (event) => act(() => engine.setDeck(i, { eq: { [key.toLowerCase()]: Number(event.target.value) } })));
  for (const key of ["Mute", "Solo"]) on($(`d${i}${key}`), "click", () => { const field = key.toLowerCase(); engine.setDeck(i, { [field]: !engine.getDeckState(i)[field] }); });
  on($(`d${i}Edit`), "click", () => editDeck(i));
  on($(`d${i}Details`), "toggle", () => { if (!isRecordView()) $(`d${i}Edit`).setAttribute("aria-expanded", String($(`d${i}Details`).open)); });
  on(deck, "dragover", (event) => { if (event.dataTransfer.types.includes("Files")) { event.preventDefault(); deck.classList.add("is-dragover"); } });
  on(deck, "dragleave", (event) => { if (!deck.contains(event.relatedTarget)) deck.classList.remove("is-dragover"); });
  on(deck, "drop", (event) => { event.preventDefault(); deck.classList.remove("is-dragover"); const file = event.dataTransfer.files[0]; if (file) act(() => importFile(i, file)); });
  let waveHand = null, waveKeyboard = null;
  const wave = $(`d${i}Wave`);
  const releaseWave = () => {
    if (!waveHand && waveKeyboard === null) return;
    const id = waveHand?.id; waveHand = null; waveKeyboard = null;
    seeking.delete(i); engine.endScratch(i);
    if (id !== undefined && wave.hasPointerCapture(id)) wave.releasePointerCapture(id);
  };
  on(wave, "pointerdown", event => {
    if (event.button !== 0 || waveHand) return;
    event.preventDefault(); releasePlatter(); wave.focus({ preventScroll: true });
    if (!engine.beginScratch(i)) return;
    const d = engine.getDeckState(i), bounds = wave.getBoundingClientRect();
    waveHand = { id: event.pointerId, x: event.clientX, position: d.position, secondsPerPixel: d.duration / Math.max(1, bounds.width) };
    waveKeyboard = null; wave.setPointerCapture(event.pointerId); seeking.add(i);
  });
  on(wave, "pointermove", event => {
    if (event.pointerId !== waveHand?.id) return;
    engine.scratchTo(i, waveHand.position + (event.clientX - waveHand.x) * waveHand.secondsPerPixel);
  });
  on(wave, "keydown", event => {
    if (!["ArrowLeft", "ArrowRight"].includes(event.key) || waveHand) return;
    event.preventDefault(); event.stopPropagation();
    if (waveKeyboard === null) {
      releasePlatter(); if (!engine.beginScratch(i)) return;
      waveKeyboard = engine.getDeckState(i).position; seeking.add(i);
    }
    waveKeyboard += (event.key === "ArrowLeft" ? -1 : 1) * (event.shiftKey ? .015 : .075);
    engine.scratchTo(i, waveKeyboard);
  });
  on(wave, "keyup", event => { if (["ArrowLeft", "ArrowRight"].includes(event.key)) releaseWave(); });
  on(wave, "blur", releaseWave);
  for (const type of ["pointerup", "pointercancel", "lostpointercapture"]) on(wave, type, event => { if (event.pointerId === waveHand?.id) releaseWave(); });
  const platter = $(`d${i}Platter`);
  let hand = null, keyboardTarget = null;
  const recordLength = d => Math.max(.001, d.duration);
  const rotateTo = d => {
    const phase = d.position / recordLength(d);
    deck.querySelector(".wb-record-surface").style.setProperty("--record-angle", `${phase * 360}deg`);
  };
  const updateRecord = d => { if (!reducedMotion.matches || d.scratching) rotateTo(d); };
  const angle = (event) => { const r = platter.getBoundingClientRect(); return Math.atan2(event.clientY - r.top - r.height / 2, event.clientX - r.left - r.width / 2); };
  const releasePlatter = () => {
    if (!hand && keyboardTarget === null) return;
    const pointerId = hand?.id;
    hand = null; keyboardTarget = null;
    engine.endScratch(i);
    if (pointerId !== undefined && platter.hasPointerCapture(pointerId)) platter.releasePointerCapture(pointerId);
  };
  on(platter, "pointerdown", (event) => {
    if (event.button !== 0 || hand) return;
    event.preventDefault(); releaseWave(); platter.focus({ preventScroll: true });
    if (!engine.beginScratch(i)) return;
    const d = engine.getDeckState(i);
    hand = { id: event.pointerId, angle: angle(event), position: d.position, duration: recordLength(d) };
    keyboardTarget = null; platter.setPointerCapture(event.pointerId);
  });
  on(platter, "pointermove", (event) => {
    if (event.pointerId !== hand?.id) return;
    const next = angle(event), delta = Math.atan2(Math.sin(next - hand.angle), Math.cos(next - hand.angle));
    hand.position += delta / (Math.PI * 2) * hand.duration; hand.angle = next;
    engine.scratchTo(i, hand.position);
    const d = engine.getDeckState(i);
    rotateTo(d);
  });
  for (const type of ["pointerup", "pointercancel", "lostpointercapture"]) on(platter, type, (event) => { if (event.pointerId === hand?.id) releasePlatter(); });
  on(platter, "keydown", (event) => {
    if (!["ArrowLeft", "ArrowRight"].includes(event.key) || hand) return;
    event.preventDefault(); event.stopPropagation();
    if (keyboardTarget === null) { releaseWave(); if (!engine.beginScratch(i)) return; keyboardTarget = engine.getDeckState(i).position; }
    const step = (event.key === "ArrowLeft" ? -1 : 1) * (event.shiftKey ? .015 : .075);
    keyboardTarget += step;
    engine.scratchTo(i, keyboardTarget);
    const d = engine.getDeckState(i);
    rotateTo(d);
  });
  on(platter, "keyup", (event) => { if (["ArrowLeft", "ArrowRight"].includes(event.key) && keyboardTarget !== null) releasePlatter(); });
  on(platter, "blur", () => { if (keyboardTarget !== null) releasePlatter(); });
  const release = () => { releasePlatter(); releaseWave(); releaseCue(); recordGain.cancelGesture(); };
  on(window, "blur", release);
  on(document, "visibilitychange", () => { if (document.hidden) release(); });
  return { root: deck, wave, platter, release, updateRecord, placeControls, recordGain, recordWave: $(`d${i}RecordWave`), recordContext: $(`d${i}RecordWave`).getContext("2d"), disc: deck.querySelector(".wb-record-surface"), context: wave.getContext("2d") };
});

function bindCue(button, deckIndex) {
  let held = null, pointer = null, key = null;
  const begin = () => {
    const index = deckIndex();
    if (index === null || held !== null) return;
    act(() => { if (engine.beginCuePreview(index) !== false) held = index; });
  };
  const release = () => {
    if (held === null) return;
    const index = held, previousPointer = pointer;
    held = null; pointer = null; key = null;
    act(() => engine.endCuePreview(index));
    if (previousPointer !== null && button.hasPointerCapture(previousPointer)) button.releasePointerCapture(previousPointer);
  };
  on(button, "pointerdown", event => {
    if (event.button !== 0 || held !== null) return;
    event.preventDefault(); button.focus({ preventScroll: true }); begin();
    if (held !== null) { pointer = event.pointerId; button.setPointerCapture(pointer); }
  });
  for (const type of ["pointerup", "pointercancel", "lostpointercapture"]) on(button, type, event => {
    if (event.pointerId === pointer) release();
  });
  on(button, "keydown", event => {
    if (![" ", "Enter"].includes(event.key)) return;
    event.preventDefault(); event.stopPropagation();
    if (!event.repeat) { begin(); key = event.key; }
  });
  on(button, "keyup", event => { if (event.key === key) { event.preventDefault(); event.stopPropagation(); release(); } });
  on(button, "click", event => {
    // Pointer/keyboard hold has already performed the action; accessibility
    // activation without a press/release sequence still gets a normal cue jump.
    if (event.detail === 0 && held === null) { const index = deckIndex(); if (index !== null) act(() => engine.cue(index)); }
  });
  on(button, "blur", () => { if (pointer === null) release(); }); on(window, "blur", release);
  on(document, "visibilitychange", () => { if (document.hidden) release(); });
  cueReleases.add(release);
  return release;
}
const speedText = rate => `${rate >= 1 ? "+" : ""}${((rate - 1) * 100).toFixed(1)}%`;
const signed = number => `${number > 0 ? "+" : ""}${Number(number).toFixed(1)}`;
function speedLimits(input, deck) {
  const range = (deck.tempoRange ?? 8) / 100;
  // An explicit SYNC match can be outside the selected manual slider span.
  input.min = Math.min(1 - range, deck.rate); input.max = Math.max(1 + range, deck.rate);
}
function say(message) { if (!disposed) $("sessionStatus").textContent = message; }
function showError(error) { if (disposed || error?.name === "AbortError") return; $("errorMessage").textContent = error?.message ?? String(error); $("errorMessage").hidden = false; }
function act(fn) { $("errorMessage").hidden = true; try { Promise.resolve(fn()).catch(showError); } catch (error) { showError(error); } }
function time(seconds, decimal = true) { const units = decimal ? 10 : 1, s = Math.floor(Math.max(0, Number(seconds) || 0) * units) / units; return `${Math.floor(s / 60)}:${(s % 60).toFixed(decimal ? 1 : 0).padStart(decimal ? 4 : 2, "0")}`; }
function value(id, next) { const node = $(id); if ((document.activeElement !== node || node.type !== "number") && node.value !== String(next)) node.value = String(next); }
function text(id, next) { const node = $(id); if (node.textContent !== next) node.textContent = next; }
async function toggleAudio() {
  const attempt = ++audioAttempt; $("errorMessage").hidden = true;
  if (engine.armed || starting) { starting = false; strip.setAudioState("off"); await engine.setAudioEnabled(false); say("Audio off · Decks keep their transport state"); return; }
  starting = true; strip.setAudioState("starting");
  try {
    await engine.arm();
    if (disposed || attempt !== audioAttempt) return;
    starting = false; strip.setAudioState(engine.armed ? "on" : "off");
    say(engine.armed ? "Audio on · Play a deck, or play all eight" : "Audio is off");
  } catch (error) { if (attempt === audioAttempt && !disposed) { starting = false; strip.setAudioState("off"); showError(error); } }
  render();
}
function confirmReplace(message) {
  if (confirmation) return Promise.resolve(false);
  for (const card of cards) card.release();
  releaseKnobs();
  $("replaceMessage").textContent = message;
  $("replaceDialog").returnValue = "cancel";
  $("replaceDialog").showModal();
  return new Promise((resolve) => { confirmation = resolve; });
}
on($("replaceDialog"), "close", () => { const resolve = confirmation; confirmation = null; resolve?.($("replaceDialog").returnValue === "replace"); });
async function importFile(i, file) {
  const d = engine.getDeckState(i);
  if (d.playing && !await confirmReplace(`Deck ${i + 1} is playing. Replace “${d.name}” with “${file.name}”?`)) return;
  if (disposed) return;
  say(`Loading ${file.name} into deck ${i + 1}…`);
  try { const loaded = await engine.loadFile(i, file); if (loaded && !disposed) say(`Deck ${i + 1} loaded · Analyzing tempo and source level`); }
  catch (error) { say(`Deck ${i + 1} kept its previous sound`); throw error; }
  render();
}
function editDeck(i) {
  if (isRecordView() || view === "pro") { openDeckSettings(i); return; }
  $(`d${i}Details`).open = !$(`d${i}Details`).open;
  render(); $("d" + i + "Edit").focus({ preventScroll: true });
}
function setView(next) {
  if (!["classic", "pro", "records", "prepare"].includes(next)) return;
  if ($("deckSettings").open) $("deckSettings").close();
  for (const card of cards) card.release();
  for (const release of cueReleases) release();
  view = next;
  $("wobblini").classList.toggle("is-records", isRecordView());
  for (const name of ["classic", "pro", "prepare"]) $("wobblini").classList.toggle("is-" + name, view === name);
  for (const name of ["classic", "pro", "records", "prepare"]) $(name + "View").setAttribute("aria-pressed", String(view === name));
  $("viewDecks").hidden = view === "records";
  $("rightDeckLabel").hidden = view === "prepare";
  text("viewName", { classic: "Classic", pro: "Pro", prepare: "Prepare", records: "Eight decks" }[view]);
  for (const [i, card] of cards.entries()) {
    card.root.hidden = view !== "records" && i !== leftDeck && (view === "prepare" || i !== rightDeck);
    card.root.style.order = String(view === "records" ? i : i === leftDeck ? 0 : 1);
    card.placeControls(isRecordView()); $(`d${i}Details`).open = view === "prepare" && i === leftDeck;
  }
  render();
}
for (const name of ["classic", "pro", "records", "prepare"]) on($(name + "View"), "click", () => setView(name));
for (const side of ["left", "right"]) {
  const select = $(side + "Deck");
  for (let i = 0; i < 8; i++) select.add(new Option(String(i + 1), String(i)));
  select.value = String(side === "left" ? leftDeck : rightDeck);
  on(select, "change", () => {
    const next = Number(select.value);
    if (side === "left") { if (next === rightDeck) rightDeck = leftDeck; leftDeck = next; }
    else { if (next === leftDeck) leftDeck = rightDeck; rightDeck = next; }
    $("leftDeck").value = leftDeck; $("rightDeck").value = rightDeck;
    setView(view);
  });
}
on($("crossfader"), "input", event => engine.setMaster({ crossfader: event.target.valueAsNumber }));
on($("crossfaderReset"), "click", () => engine.setMaster({ crossfader: 0 }));
on($("syncMode"), "change", event => engine.setMaster({ syncMode: event.target.value }));
on($("syncInterval"), "change", event => engine.setMaster({ syncInterval: Number(event.target.value) }));
on($("playButton"), "click", () => { const playing = engine.getState().decks.some((d) => d.playing); engine[playing ? "pauseAll" : "playAll"](); });
on($("stopButton"), "click", () => { for (const card of cards) card.release(); for (let i = 0; i < 8; i++) { engine.pause(i); engine.seek(i, 0); } say("Stopped · All decks at the beginning"); });
on($("syncAll"), "click", () => act(() => {
  const enabled = !engine.getState().syncAllEnabled;
  engine.setSyncEnabled(enabled);
  say(enabled ? `SYNC ALL · Deck ${engine.getState().masterDeck + 1} leads ${engine.getState().master.syncMode === "tempo" ? "tempo" : "tempo and beat position"}` : "Sync off · Deck speeds and playback kept");
}));
on($("master-bpm"), "input", (event) => {
  if (event.target.value === "" || !Number.isFinite(event.target.valueAsNumber)) return;
  engine.setMasterBpm(event.target.valueAsNumber);
});
for (const type of ["change", "blur"]) on($("master-bpm"), type, () => {
  $("master-bpm").value = engine.getState().syncBpm.toFixed(1);
});
on($("loadDemos"), "click", () => act(async () => {
  if (engine.getState().decks.some((d) => d.kind === "file") && !await confirmReplace("Replace your loaded files on all eight decks with the original demo sources?")) return;
  if (disposed) return;
  for (let i = 0; i < 8; i++) engine.loadDemo(i);
  say("Original eight-source demo set loaded");
}));
on($("resetMix"), "click", () => {
  for (let i = 0; i < 8; i++) engine.setDeck(i, { gain: initial.decks[i].gain, trimDb: 0, autoGain: initial.decks[i].autoGain, pan: 0, mute: false, solo: false, eq: { low: 0, mid: 0, high: 0 }, filter: 0, assignment: initial.decks[i].assignment });
  engine.setMaster({ crossfader: 0, wobbleAmount: 0, wobbleRate: 2 });
  say("Mixer reset · Files, tempo, pitch and playback kept");
});
for (const [id, key] of [["wobbleAmount", "wobbleAmount"], ["wobbleRate", "wobbleRate"]]) on($(id), "input", (event) => engine.setMaster({ [key]: Number(event.target.value) }));
on($("dryWobble"), "click", () => engine.setMaster({ wobbleAmount: 0 }));
on(window, "keydown", (event) => {
  if (event.repeat || event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey || event.isComposing || event.target.closest?.("input,button,select,textarea,a,summary,canvas,dialog,[contenteditable=true]")) return;
  if (/^[1-8]$/.test(event.key)) { event.preventDefault(); engine.toggle(Number(event.key) - 1); }
});

const masterKnob = enhanceRangeKnob($("master-bpm"));
const settingsKnobs = ["settingsSpeed", "settingsPitch", "settingsTrim", "settingsVolume"].map(id => enhanceRangeKnob($(id)));
const releaseKnobs = () => { masterKnob.cancelGesture(); for (const knob of settingsKnobs) knob.cancelGesture(); };
on(window, "blur", releaseKnobs);
on(document, "visibilitychange", () => { if (document.hidden) releaseKnobs(); });
function openDeckSettings(index) {
  for (const card of cards) card.release();
  releaseKnobs();
  settingsDeck = index;
  $("deckSettings").style.setProperty("--deck-color", colors[index]);
  $("deckSettings").style.setProperty("--accent", colors[index]);
  renderDeckSettings();
  $("deckSettings").showModal();
  $("d" + index + "Edit").setAttribute("aria-expanded", "true");
  $("closeDeckSettings").focus();
}
function renderDeckSettings() {
  if (settingsDeck === null) return;
  const d = engine.getDeckState(settingsDeck), number = settingsDeck + 1;
  const master = engine.getState().masterDeck;
  text("deckSettingsTitle", d.kind === "file" ? d.name : "Demo source " + number);
  text("deckSettingsTrack", "Deck " + number);
  $("settingsLoad").setAttribute("aria-busy", String(d.loading));
  setIcon($("settingsLoad"), "load", "Load audio into deck " + number);
  $("settingsSync").disabled = settingsDeck === master;
  $("settingsSync").setAttribute("aria-pressed", String(!!d.syncEnabled));
  $("settingsSync").setAttribute("aria-label", settingsDeck === master ? `Deck ${number} is the tempo master` : `${d.syncEnabled ? "Release" : "Sync"} deck ${number}${d.syncEnabled ? " from sync" : ` to deck ${master + 1}`}`);
  speedLimits($("settingsSpeed"), d);
  value("settingsSpeed", d.rate); value("settingsVolume", d.gain); value("settingsBpm", d.bpm);
  value("settingsPitch", d.pitchSemitones ?? 0); value("settingsTrim", d.trimDb ?? 0);
  value("settingsPan", d.pan); value("settingsAssignment", d.assignment);
  value("settingsTempoRange", d.tempoRange ?? 8); value("settingsBeatOffset", d.beatOffset ?? 0);
  $("settingsBeatOffset").max = d.duration;
  $("settingsAutoGain").checked = !!d.autoGain;
  $("settingsKeyLock").setAttribute("aria-pressed", String(!!d.keyLock));
  $("settingsSlip").setAttribute("aria-pressed", String(!!d.slipEnabled));
  $("settingsCue").setAttribute("aria-pressed", String(!!d.cuePreviewing));
  $("settingsPlay").setAttribute("aria-pressed", String(d.playing && !d.cuePreviewing));
  setIcon($("settingsPlay"), d.playing && !d.cuePreviewing ? "pause" : "play", `${d.cuePreviewing ? "Continue" : d.playing ? "Pause" : "Play"} deck ${number}`);
  text("settingsPitchOut", signed(d.pitchSemitones ?? 0) + " st");
  text("settingsTrimOut", signed(d.trimDb ?? 0) + " dB");
  text("settingsPanOut", Math.abs(d.pan) < .01 ? "Center" : `${d.pan < 0 ? "L" : "R"} ${Math.round(Math.abs(d.pan) * 100)}%`);
  text("settingsSpeedOut", speedText(d.rate)); text("settingsVolumeOut", Math.round(d.gain * 100) + "%");
  for (const knob of settingsKnobs) knob.update();
  $("settingsSeek").max = d.duration;
  if (document.activeElement !== $("settingsSeek")) value("settingsSeek", d.position);
  text("settingsPosition", time(d.position));
  text("settingsStatus", (d.analysisStatus === "analyzing" ? "Analyzing tempo… · " : d.analysisStatus === "fallback" ? "Tempo uncertain · Edit source BPM · " : "") + (d.pitchStatus === "preparing" ? "Preparing pitch… · " : d.pitchError ? d.pitchError + " · " : "") + (d.syncError || (settingsDeck === master ? "Tempo master" : d.syncEnabled
    ? d.syncActive ? `Synced to deck ${master + 1}` : "Sync ready · Waiting for playback" : "Independent speed")));
}
on($("closeDeckSettings"), "click", () => $("deckSettings").close());
on($("deckSettings"), "close", () => {
  for (const release of cueReleases) release();
  const index = settingsDeck; settingsDeck = null;
  for (const knob of settingsKnobs) knob.cancelGesture();
  if (!disposed && index !== null) {
    $("d" + index + "Edit").setAttribute("aria-expanded", "false");
    $("d" + index + "Edit").focus({ preventScroll: true });
  }
});
on($("deckSettings"), "click", (event) => {
  const r = $("deckSettings").getBoundingClientRect();
  if (event.target === $("deckSettings") && (event.clientX < r.left || event.clientX > r.right || event.clientY < r.top || event.clientY > r.bottom)) $("deckSettings").close();
});
on($("settingsLoad"), "click", () => { if (settingsDeck !== null) $("d" + settingsDeck + "File").click(); });
on($("settingsSync"), "click", () => { if (settingsDeck !== null && settingsDeck !== engine.getState().masterDeck) engine.setDeckSyncEnabled(settingsDeck, !engine.getDeckState(settingsDeck).syncEnabled); });
for (const [id, field] of [["settingsSpeed", "rate"], ["settingsVolume", "gain"], ["settingsBpm", "bpm"], ["settingsTrim", "trimDb"], ["settingsPitch", "pitchSemitones"], ["settingsPan", "pan"], ["settingsBeatOffset", "beatOffset"]]) {
  on($(id), "input", (event) => {
    if (settingsDeck !== null && event.target.value !== "" && Number.isFinite(event.target.valueAsNumber)) engine.setDeck(settingsDeck, { [field]: event.target.valueAsNumber });
  });
  on($(id), "change", renderDeckSettings);
}
on($("settingsBpm"), "blur", () => { if (settingsDeck !== null) $("settingsBpm").value = engine.getDeckState(settingsDeck).bpm; });
on($("settingsSpeedReset"), "click", () => { if (settingsDeck !== null) { engine.setDeck(settingsDeck, { rate: 1 }); renderDeckSettings(); } });
on($("settingsSpeed"), "dblclick", () => $("settingsSpeedReset").click());
on($("settingsSeek"), "input", (event) => { if (settingsDeck !== null) engine.seek(settingsDeck, Number(event.target.value)); });
bindCue($("settingsCue"), () => settingsDeck);
on($("settingsPlay"), "pointerdown", event => { if (settingsDeck !== null && engine.getDeckState(settingsDeck).cuePreviewing) event.preventDefault(); });
on($("settingsPlay"), "click", () => { if (settingsDeck !== null) act(() => engine.toggle(settingsDeck)); });
on($("settingsPitchReset"), "click", () => { if (settingsDeck !== null) engine.setDeck(settingsDeck, { pitchSemitones: 0 }); });
on($("settingsAutoGain"), "change", event => { if (settingsDeck !== null) engine.setDeck(settingsDeck, { autoGain: event.target.checked }); });
for (const [id, field] of [["settingsKeyLock", "keyLock"], ["settingsSlip", "slipEnabled"]]) on($(id), "click", () => {
  if (settingsDeck !== null) act(() => engine.setDeck(settingsDeck, { [field]: !engine.getDeckState(settingsDeck)[field] }));
});
on($("settingsAssignment"), "change", event => { if (settingsDeck !== null) engine.setDeck(settingsDeck, { assignment: event.target.value }); });
on($("settingsTempoRange"), "change", event => { if (settingsDeck !== null) engine.setDeck(settingsDeck, { tempoRange: Number(event.target.value) }); });
on($("settingsSetCue"), "click", () => { if (settingsDeck !== null) engine.setCue(settingsDeck); });

const pad = $("wobble-pad"), padContext = pad.getContext("2d");
function padMove(event) {
  const r = pad.getBoundingClientRect();
  const x = Math.min(1, Math.max(0, (event.clientX - r.left) / r.width));
  const y = Math.min(1, Math.max(0, 1 - (event.clientY - r.top) / r.height));
  engine.setMaster({ wobbleAmount: x, wobbleRate: 0.125 * 64 ** y });
}
on(pad, "pointerdown", (event) => { if (event.button !== 0) return; padPointer = event.pointerId; pad.setPointerCapture(padPointer); padMove(event); });
on(pad, "pointermove", (event) => { if (event.pointerId === padPointer) padMove(event); });
for (const type of ["pointerup", "pointercancel", "lostpointercapture"]) on(pad, type, (event) => { if (event.pointerId !== padPointer) return; padPointer = null; if (pad.hasPointerCapture(event.pointerId)) pad.releasePointerCapture(event.pointerId); });
on(pad, "keydown", (event) => {
  const m = engine.getState().master, step = event.shiftKey ? 0.01 : 0.05;
  const patches = { ArrowLeft: { wobbleAmount: m.wobbleAmount - step }, ArrowRight: { wobbleAmount: m.wobbleAmount + step }, ArrowUp: { wobbleRate: m.wobbleRate * 1.2 }, ArrowDown: { wobbleRate: m.wobbleRate / 1.2 }, Home: { wobbleAmount: 0 } };
  if (patches[event.key]) { event.preventDefault(); engine.setMaster(patches[event.key]); }
});

function render() {
  if (!initialized || disposed) return;
  renderPending = false;
  const state = engine.getState(), count = state.decks.filter((d) => d.playing).length;
  if (!starting) strip.setAudioState(state.armed ? "on" : "off");
  renderDeckSettings();
  value("crossfader", state.master.crossfader);
  $("crossfader").setAttribute("aria-valuetext", state.master.crossfader === 0 ? "Center: both groups" : `${state.master.crossfader < 0 ? "A" : "B"} ${Math.round(Math.abs(state.master.crossfader) * 100)}%`);
  value("syncMode", state.master.syncMode ?? "beat"); value("syncInterval", state.master.syncInterval ?? 1);
  $("syncInterval").disabled = state.master.syncMode === "tempo";
  $("playButton").setAttribute("aria-pressed", String(count > 0)); setIcon($("playButton"), count ? "pause" : "play", count ? "Pause all" : "Play all");
  $("syncAll").setAttribute("aria-pressed", String(!!state.syncAllEnabled));
  const syncErrors = state.decks.filter((d) => d.syncError);
  const syncWarning = state.syncEnabled && syncErrors.length
    ? [...new Set(syncErrors.map((d) => d.syncError))].map((message) => {
      const decks = syncErrors.filter((d) => d.syncError === message).map((d) => d.id + 1);
      return (decks.length > 1 ? "Decks " : "Deck ") + decks.join(", ") + ": " + message;
    }).join(" ") : "";
  if (syncWarning !== lastSyncWarning || (syncWarning && $("errorMessage").hidden)) {
    if (syncWarning) { $("errorMessage").textContent = syncWarning; $("errorMessage").hidden = false; }
    else if ($("errorMessage").textContent === lastSyncWarning) $("errorMessage").hidden = true;
    lastSyncWarning = syncWarning;
  }
  $("syncAll").classList.toggle("has-sync-warning", !!state.syncEnabled && syncErrors.length > 0);
  $("syncAll").setAttribute("aria-label", state.syncAllEnabled ? "Release all decks from sync" : `Sync all decks to deck ${state.masterDeck + 1}`);
  $("syncAll").title = syncWarning || (state.syncAllEnabled
    ? `SYNC ALL · Deck ${state.masterDeck + 1} is master. Click to release sync.`
    : `Sync all decks to deck ${state.masterDeck + 1} · Uses the analyzed or manually corrected beat grid`);
  $("master-bpm").min = Math.min(state.syncBpm, state.decks[state.masterDeck].bpm * (1 - (state.decks[state.masterDeck].tempoRange ?? 8) / 100));
  $("master-bpm").max = Math.max(state.syncBpm, state.decks[state.masterDeck].bpm * (1 + (state.decks[state.masterDeck].tempoRange ?? 8) / 100));
  value("master-bpm", Number(state.syncBpm.toFixed(1)));
  text("masterBpmOut", state.syncBpm.toFixed(1)); masterKnob.update();
  $("activeDecks").value = `${count} / 8 playing`;
  $("liveDot").classList.toggle("is-on", state.armed && count > 0);
  for (let i = 0; i < 8; i++) {
    const d = state.decks[i];
    // Position changes need the graphic/readout, not every hidden editor field.
    const key = [d.name, d.kind, d.loading, d.playing, d.scratching, d.mute, d.solo,
      state.decks.some((v) => v.solo), d.duration, d.cuePoint, d.effectiveBpm,
      d.gain, d.rate, d.bpm, d.pan, d.filter, d.assignment,
      d.eq.low, d.eq.mid, d.eq.high, d.syncActive, d.syncEnabled, d.syncError, state.syncEnabled, state.masterDeck, view, d.trimDb, d.autoGain, d.autoGainDb, d.keyLock, d.pitchSemitones, d.tempoRange, d.slipEnabled, d.beatOffset, d.analysisStatus, d.pitchStatus, d.cuePreviewing].join("|");
    if (cards[i].renderKey === key) continue;
    cards[i].renderKey = key;
    cards[i].root.classList.toggle("is-playing", d.playing); cards[i].root.classList.toggle("is-muted", d.mute || (state.decks.some((v) => v.solo) && !d.solo));
    cards[i].root.classList.toggle("is-scratching", !!d.scratching);
    cards[i].root.classList.toggle("is-synced", !!d.syncActive);
    cards[i].root.classList.toggle("has-sync-warning", !!d.syncError && !!state.syncEnabled);
    const isMaster = i === state.masterDeck;
    const syncLabel = isMaster ? "Tempo master" : d.syncEnabled ? d.syncError || (d.syncActive ? `Synced to deck ${state.masterDeck + 1}` : `Sync waits for deck ${state.masterDeck + 1} to play`) : "Independent tempo";
    text("d" + i + "SyncStatus", syncLabel);
    $(`d${i}Master`).setAttribute("aria-pressed", String(isMaster));
    $(`d${i}Master`).title = isMaster ? `Deck ${i + 1} is the tempo master` : `Make deck ${i + 1} the tempo master`;
    $(`d${i}Master`).setAttribute("aria-label", $(`d${i}Master`).title);
    $(`d${i}Sync`).disabled = isMaster;
    $(`d${i}Sync`).setAttribute("aria-pressed", String(!!d.syncEnabled));
    $(`d${i}Sync`).title = syncLabel;
    $(`d${i}Sync`).setAttribute("aria-label", isMaster ? `Deck ${i + 1} is the tempo master` : `${d.syncEnabled ? "Release" : "Sync"} deck ${i + 1}${d.syncEnabled ? " from sync" : ` to deck ${state.masterDeck + 1}`}`);
    text(`d${i}Name`, d.name); cards[i].platter.title = d.name;
    const analysisLabel = d.analysisStatus === "analyzing" ? "Analyzing tempo…" : d.analysisStatus === "fallback" ? "Tempo uncertain · Edit source BPM" : "";
    text(`d${i}Kind`, d.loading ? "Loading…" : [analysisLabel, d.pitchStatus === "preparing" ? "Preparing pitch…" : d.pitchError || ""].filter(Boolean).join(" · "));
    $("d" + i + "Load").setAttribute("aria-busy", String(d.loading));
    setIcon($("d" + i + "Load"), "load", "Load audio into deck " + (i + 1));
    $(`d${i}Play`).setAttribute("aria-pressed", String(d.playing && !d.cuePreviewing));
    setIcon($(`d${i}Play`), d.playing && !d.cuePreviewing ? "pause" : "play", `${d.cuePreviewing ? "Continue" : d.playing ? "Pause" : "Play"} deck ${i + 1}`);
    $(`d${i}Mute`).setAttribute("aria-pressed", String(d.mute)); $(`d${i}Solo`).setAttribute("aria-pressed", String(d.solo));
    $(`d${i}Effective`).innerHTML = `${d.effectiveBpm.toFixed(1)} <small>BPM</small>`;
    $(`d${i}Seek`).max = String(d.duration || 1); $(`d${i}Duration`).value = time(d.duration, false);
    $(`d${i}Cue`).title = `Return to ${time(d.cuePoint)}; hold to preview when paused`;
    $(`d${i}Cue`).setAttribute("aria-pressed", String(!!d.cuePreviewing));
    for (const [key, field] of [["Gain", "gain"], ["Rate", "rate"], ["Bpm", "bpm"], ["Pan", "pan"], ["Filter", "filter"]]) value(`d${i}${key}`, d[field]);
    speedLimits($(`d${i}Rate`), d); value(`d${i}Rate`, d.rate);
    for (const [key, field] of [["Trim", "trimDb"], ["Pitch", "pitchSemitones"], ["BeatOffset", "beatOffset"]]) value(`d${i}${key}`, d[field] ?? 0);
    value(`d${i}TempoRange`, d.tempoRange ?? 8); value(`d${i}Assignment`, d.assignment);
    $(`d${i}AutoGain`).checked = !!d.autoGain;
    text(`d${i}AutoGainOut`, d.autoGain ? signed(d.autoGainDb ?? 0) + " dB" : "");
    $(`d${i}KeyLock`).setAttribute("aria-pressed", String(!!d.keyLock));
    $(`d${i}Slip`).setAttribute("aria-pressed", String(!!d.slipEnabled));
    $(`d${i}BeatOffset`).max = d.duration;
    text(`d${i}TrimOut`, signed(d.trimDb ?? 0) + " dB"); text(`d${i}PitchOut`, signed(d.pitchSemitones ?? 0) + " st");
    value(`d${i}RecordGain`, d.gain); cards[i].recordGain.update();
    $(`d${i}GainOut`).value = `${Math.round(d.gain * 100)}%`; $(`d${i}RateOut`).value = speedText(d.rate);
    for (const key of ["Low", "Mid", "High"]) { const n = d.eq[key.toLowerCase()]; value(`d${i}${key}`, n); $(`d${i}${key}Out`).value = `${n > 0 ? "+" : ""}${n.toFixed(1)} dB`; }
    $(`d${i}PanOut`).value = Math.abs(d.pan) < 0.01 ? "Center" : `${d.pan < 0 ? "L" : "R"} ${Math.round(Math.abs(d.pan) * 100)}%`;
    $(`d${i}FilterOut`).value = Math.abs(d.filter) < 0.01 ? "Open" : `${d.filter < 0 ? "Low" : "High"} ${Math.round(Math.abs(d.filter) * 100)}%`;
    const editor = $(`d${i}Edit`), popup = view !== "prepare";
    editor.setAttribute("aria-controls", popup ? "deckSettings" : `d${i}Details`);
    editor.setAttribute("aria-expanded", String(popup ? settingsDeck === i && $("deckSettings").open : $(`d${i}Details`).open));
    if (popup) editor.setAttribute("aria-haspopup", "dialog"); else editor.removeAttribute("aria-haspopup");
    setIcon(editor, popup ? "gear" : "sliders", `Track controls for deck ${i + 1}`);
  }
  for (const id of ["wobbleAmount", "wobbleRate"]) value(id, state.master[id]);
  $("wobbleAmountOut").value = `${Math.round(state.master.wobbleAmount * 100)}%`; $("wobbleRateOut").value = `${state.master.wobbleRate.toFixed(2)} Hz`;
}

const canvasSizes = new WeakMap();
const resizeObserver = new ResizeObserver((entries) => {
  for (const { target } of entries) canvasSizes.delete(target);
});
for (const canvas of [...cards.flatMap((card) => [card.wave, card.recordWave]), pad]) resizeObserver.observe(canvas);
const visible = new Set(cards.map((card) => card.root));
visible.add(pad);
const visibilityObserver = new IntersectionObserver((entries) => {
  for (const { target, isIntersecting } of entries) {
    if (isIntersecting) visible.add(target); else visible.delete(target);
  }
});
for (const target of visible) visibilityObserver.observe(target);
function canvasSize(canvas) {
  let size = canvasSizes.get(canvas);
  const scale = Math.min(pixelRatioLimit, window.devicePixelRatio || 1);
  if (!size || size.scale !== scale) {
    // Rotation expands bounding boxes, not the canvas's layout or pixel budget.
    size = { width: canvas.clientWidth, height: canvas.clientHeight, scale };
    canvasSizes.set(canvas, size);
  }
  return size;
}
function prepareCanvas(canvas, ctx) {
  const { width: w, height: h, scale } = canvasSize(canvas);
  const width = Math.max(1, Math.round(w * scale)), height = Math.max(1, Math.round(h * scale));
  if (canvas.width !== width || canvas.height !== height) { canvas.width = width; canvas.height = height; }
  ctx.setTransform(scale, 0, 0, scale, 0, 0); ctx.clearRect(0, 0, w, h);
  return [w, h];
}
function drawWave(card, d, color) {
  const ctx = card.context, [w, h] = prepareCanvas(card.wave, ctx);
  ctx.strokeStyle = "#344653"; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(0, h / 2); ctx.lineTo(w, h / 2); ctx.stroke();
  const peaks = d.peaks || [], count = Math.min(160, Math.floor(w / 2));
  ctx.lineWidth = Math.max(1, w / count - 1); ctx.strokeStyle = color; ctx.globalAlpha = d.playing ? .95 : .55; ctx.beginPath();
  for (let n = 0; n < count; n++) { const p = Math.min(1, Math.abs(peaks[Math.floor(n / count * peaks.length)] || 0)); const x = n / count * w; const y = Math.max(1, p * h * .46); ctx.moveTo(x, h / 2 - y); ctx.lineTo(x, h / 2 + y); }
  ctx.stroke(); ctx.globalAlpha = 1;
  if (d.duration) {
    const x = d.position / d.duration * w;
    ctx.fillStyle = "#f4f8fc"; ctx.fillRect(x, 0, 1.5, h);
    const cue = d.cuePoint / d.duration * w; ctx.fillStyle = color; ctx.beginPath(); ctx.moveTo(cue, 0); ctx.lineTo(cue + 5, 0); ctx.lineTo(cue, 6); ctx.fill();
  }
}
function drawRecordWave(card, d, color) {
  const ctx = card.recordContext, [w, h] = prepareCanvas(card.recordWave, card.recordContext);
  if (!w || !h) return;
  const cx = w / 2, cy = h / 2, radius = Math.min(w, h) * .355;
  const peaks = d.peaks || [];
  let cached = card.recordCache;
  if (!cached || cached.peaks !== peaks || cached.width !== card.recordWave.width || cached.height !== card.recordWave.height) {
    const layer = document.createElement("canvas");
    layer.width = card.recordWave.width; layer.height = card.recordWave.height;
    const paint = layer.getContext("2d"), scale = canvasSize(card.recordWave).scale;
    paint.setTransform(scale, 0, 0, scale, 0, 0);
    paint.lineWidth = Math.max(1, w / 240); paint.strokeStyle = color; paint.beginPath();
    const count = Math.min(constrained ? 160 : 240, Math.max(80, Math.floor(w)));
    for (let n = 0; n < count; n++) {
      // Audio runs counterclockwise around the record. Clockwise rotation brings
      // each sample under the stationary 3 o'clock needle once per file.
      const angle = -n / count * Math.PI * 2;
      const peak = Math.min(1, Math.abs(peaks[Math.floor(n / count * peaks.length)] || 0));
      const amplitude = Math.max(.7, Math.sqrt(peak) * Math.min(w, h) * .12);
      paint.moveTo(cx + Math.cos(angle) * (radius - amplitude), cy + Math.sin(angle) * (radius - amplitude));
      paint.lineTo(cx + Math.cos(angle) * (radius + amplitude), cy + Math.sin(angle) * (radius + amplitude));
    }
    paint.stroke();
    cached = card.recordCache = { layer, peaks, width: layer.width, height: layer.height };
  }
  ctx.globalAlpha = .9; ctx.drawImage(cached.layer, 0, 0, w, h); ctx.globalAlpha = 1;
}

function drawPad(state) {
  const ctx = padContext, [w, h] = prepareCanvas(pad, ctx), { wobbleAmount: depth, wobbleRate: rate } = state.master;
  ctx.strokeStyle = "#1e303d"; ctx.lineWidth = 1;
  for (let i = 1; i < 4; i++) { ctx.beginPath(); ctx.moveTo(w * i / 4, 0); ctx.lineTo(w * i / 4, h); ctx.moveTo(0, h * i / 4); ctx.lineTo(w, h * i / 4); ctx.stroke(); }
  // Follow the actual filter oscillator, including rate ramps and suspension.
  const phase = engine.getWobbleState().phase;
  ctx.strokeStyle = "#c5f078"; ctx.lineWidth = 1.5; ctx.beginPath();
  for (let x = 0; x <= w; x += 2) { const y = h / 2 + Math.sin(x / w * Math.PI * 4 + phase * Math.PI * 2) * depth * h * .33; if (!x) ctx.moveTo(x, y); else ctx.lineTo(x, y); }
  ctx.stroke();
  const x = depth * (w - 12) + 6, y = (1 - Math.log2(Math.max(.125, rate) / .125) / 6) * (h - 12) + 6;
  ctx.strokeStyle = "#e4f6c4"; ctx.lineWidth = 1; ctx.beginPath(); ctx.arc(x, y, 6, 0, Math.PI * 2); ctx.stroke(); ctx.fillStyle = "#c5f078"; ctx.beginPath(); ctx.arc(x, y, 2, 0, Math.PI * 2); ctx.fill();
}
function animate(now) {
  if (disposed) return;
  if (!document.hidden && now - lastDraw >= drawInterval) {
    lastDraw = now; const state = engine.getState();
    const readout = now - lastReadout >= 200;
    if (renderPending || readout) render();
    if (readout) lastReadout = now;
    for (let i = 0; i < 8; i++) {
      const d = state.decks[i], card = cards[i];
      if (card.root.hidden || !visible.has(card.root)) continue;
      const size = canvasSize(isRecordView() ? card.recordWave : card.wave);
      const key = [view, d.position, d.playing, d.cuePoint, d.duration].join("|");
      if (card.drawKey !== key || card.drawSize !== size || card.drawPeaks !== d.peaks) {
        card.updateRecord(d);
        if (!isRecordView()) drawWave(card, d, colors[i]); else drawRecordWave(card, d, colors[i]);
        card.drawKey = key; card.drawSize = size; card.drawPeaks = d.peaks;
      }
      if (!readout) continue;
      for (const surface of [card.platter, card.wave]) {
        surface.setAttribute("aria-valuemax", String(d.duration));
        surface.setAttribute("aria-valuenow", d.position.toFixed(2));
        surface.setAttribute("aria-valuetext", `${time(d.position)} of ${time(d.duration)}`);
      }
      if (!isRecordView()) { value(`d${i}Time`, time(d.position)); if (!seeking.has(i) && document.activeElement !== $(`d${i}Seek`)) value(`d${i}Seek`, d.position); }
    }
    if (!isRecordView() && visible.has(pad)) drawPad(state);
    const count = state.decks.filter((d) => d.playing).length;
    if ($("activeDecks").value !== `${count} / 8 playing`) render();
  }
  frame = requestAnimationFrame(animate);
}
async function dispose() {
  if (disposed) return; disposed = true; audioAttempt++; abort.abort(); cancelAnimationFrame(frame); confirmation?.(false); confirmation = null;
  for (const card of cards) { card.release(); card.recordGain.destroy(); }
  masterKnob.destroy();
  for (const knob of settingsKnobs) knob.destroy();
  for (const release of cueReleases) release(); cueReleases.clear();
  resizeObserver.disconnect(); visibilityObserver.disconnect(); strip.destroy?.(); await engine.dispose();
}
on(window, "pagehide", (event) => {
  // A back-forward-cache restoration needs a fresh engine after this teardown.
  // Keep only this one-shot restoration listener outside the aborted lifecycle.
  if (event.persisted) window.addEventListener("pageshow", () => window.location.reload(), { once: true });
  void dispose();
});
initialized = true; render(); frame = requestAnimationFrame(animate);

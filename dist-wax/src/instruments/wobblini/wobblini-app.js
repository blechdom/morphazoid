import { createAudioStrip } from "../../ui/patterns/audio-strip.js";
import { WobbliniAudio } from "./wobblini-audio.js";

const $ = (id) => document.getElementById(id);
const abort = new AbortController();
const on = (node, type, fn, options = {}) => node.addEventListener(type, fn, { ...options, signal: abort.signal });
const colors = ["#c5f078", "#75dfc7", "#76c6f3", "#f1ca78", "#c6a2fa", "#fa9fb8", "#f6ae81", "#91b6fa"];
let initialized = false, disposed = false, starting = false, audioAttempt = 0, frame = 0, lastDraw = 0;
let view = "records", tiny = false, selected = null, confirmation = null, padPointer = null;
const seeking = new Set();
export const engine = new WobbliniAudio({ onChange: () => { if (initialized) render(); }, onError: showError });
const initial = engine.getState();
const strip = createAudioStrip({ buttonId: "audioButton", levelId: "level", level: initial.master.gain,
  min: 0, max: 1, step: 0.01, onAudioClick: toggleAudio, onLevelInput: (gain) => engine.setMaster({ gain }) });
$("audioSlot").replaceWith(strip);

const icons = {
  play: '<path d="m9 5 11 7-11 7Z" fill="currentColor" stroke="none"/>',
  pause: '<path d="M8 5v14M16 5v14" stroke-width="4"/>',
  stop: '<rect x="6" y="6" width="12" height="12" rx="1" fill="currentColor" stroke="none"/>',
  record: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="3"/><path d="M5 9a8 8 0 0 1 4-4m10 10a8 8 0 0 1-4 4"/>',
  sliders: '<path d="M5 3v18M12 3v18M19 3v18"/><path d="M2 8h6m1 8h6m1-10h6" stroke-width="4"/>',
  grid: '<path d="M3 5h3v4H3zm5 0h3v4H8zm5 0h3v4h-3zm5 0h3v4h-3zM3 15h3v4H3zm5 0h3v4H8zm5 0h3v4h-3zm5 0h3v4h-3z" fill="currentColor" stroke="none"/>',
  help: '<circle cx="12" cy="12" r="9"/><path d="M9 9a3 3 0 1 1 5 2c-1 .7-2 1-2 3m0 3v.1"/>',
  load: '<path d="M12 16V3m-5 5 5-5 5 5M4 14v6h16v-6"/>',
  cue: '<path d="M6 5v14m12-14L8 12l10 7Z"/>',
  setcue: '<path d="M5 21V3h11l-3 4 3 4H5m13 4v6m-3-3h6"/>',
  mute: '<path d="M11 4 6 8H3v8h3l5 4Zm5 5 6 6m0-6-6 6"/>',
  solo: '<path d="M4 15v-3a8 8 0 0 1 16 0v3M4 13h3v7H4zm13 0h3v7h-3z"/>',
  sync: '<path d="M3 8h17l-4-4m5 12H4l4 4"/>',
  music: '<path d="M9 18V5l11-2v13M9 8l11-2"/><ellipse cx="6" cy="18" rx="3" ry="2"/><ellipse cx="17" cy="16" rx="3" ry="2"/>',
  reset: '<path d="M4 9a8 8 0 1 1 0 7M4 3v6h6"/>',
  center: '<path d="M12 3v18M2 12h6m-3-3 3 3-3 3m17-3h-6m3-3-3 3 3 3"/>',
  dry: '<path d="M3 12h18M5 5l14 14"/>',
  close: '<path d="m6 6 12 12M6 18 18 6"/>',
  check: '<path d="m4 12 5 5L20 6"/>',
  tap: '<path d="m5 19 7-14 7 14ZM9 16l7-9M3 22h18"/>',
};
const icon = (name) => `<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">${icons[name]}</svg>`;
function setIcon(node, name, label) {
  if (node.dataset.renderedIcon !== name) { node.innerHTML = icon(name); node.dataset.renderedIcon = name; }
  if (label) { node.setAttribute("aria-label", label); node.title = label; }
  else if (!node.title) node.title = node.getAttribute("aria-label") || "";
}
for (const node of document.querySelectorAll("[data-icon]")) setIcon(node, node.dataset.icon);
// Preserve the shared Tap behavior while using this instrument's icon-only face.
const tapIcons = new MutationObserver(() => {
  for (const node of $("wobblini").querySelectorAll(".mz-tap-tempo:not([data-rendered-icon])")) setIcon(node, "tap");
});
tapIcons.observe($("wobblini"), { childList: true, subtree: true });

const range = (i, key, label, min, max, step, value) => `<label class="wb-control" for="d${i}${key}"><span>${label}<output id="d${i}${key}Out" for="d${i}${key}"></output></span><input id="d${i}${key}" type="range" min="${min}" max="${max}" step="${step}" value="${value}" aria-label="Deck ${i + 1} ${label}" /></label>`;
const cards = Array.from({ length: 8 }, (_, i) => {
  const deck = document.createElement("section");
  deck.className = "wb-deck"; deck.id = `deck${i}`; deck.dataset.deck = i;
  deck.style.setProperty("--deck-color", colors[i]); deck.setAttribute("aria-label", `Deck ${i + 1}`);
  deck.innerHTML = `<div class="wb-deck-header"><span class="wb-deck-number">${String(i + 1).padStart(2, "0")}</span><div class="wb-track"><h2 id="d${i}Name">Demo loop</h2><span id="d${i}Kind" class="wb-track-kind">Original demo</span></div><button id="d${i}Load" class="wb-load" type="button" aria-label="Load audio into deck ${i + 1}" title="Load audio">${icon("load")}</button><input id="d${i}File" type="file" accept="audio/*,.wav,.mp3,.m4a,.aac,.ogg,.flac,.aiff" hidden /></div>
    <div class="wb-visual"><div id="d${i}Platter" class="wb-disc" role="slider" tabindex="0" aria-label="Scratch deck ${i + 1}" aria-valuemin="0" aria-valuemax="8" aria-valuenow="0" aria-describedby="scratchHelp"><i class="wb-disc-needle" aria-hidden="true"></i><canvas id="d${i}RecordWave" class="wb-record-wave" aria-hidden="true"></canvas><span class="wb-record-label" aria-hidden="true"><span>${String(i + 1).padStart(2, "0")}</span><span id="d${i}RecordName"></span></span></div><div class="wb-wave-wrap"><canvas id="d${i}Wave" class="wb-wave" role="img" tabindex="0" aria-label="Deck ${i + 1} waveform. Drag or use left and right arrow keys to seek. Home returns to the start. A position slider also follows.">Audio waveform.</canvas><div class="wb-time"><output id="d${i}Time">0:00.0</output><output id="d${i}Duration">0:08</output></div></div></div>
    <input id="d${i}Seek" class="wb-seek" type="range" min="0" max="8" step="0.01" value="0" aria-label="Deck ${i + 1} position in seconds" />
    <div class="wb-deck-transport"><button id="d${i}Play" class="wb-deck-play" type="button" aria-label="Play deck ${i + 1}" aria-pressed="false" title="Play deck ${i + 1}">${icon("play")}</button><button id="d${i}Cue" class="wb-cue" type="button" aria-label="Return to cue on deck ${i + 1}" title="Return to cue">${icon("cue")}</button><button id="d${i}SetCue" class="wb-set-cue" type="button" aria-label="Set cue on deck ${i + 1}" title="Set cue">${icon("setcue")}</button></div>
    <div class="wb-loop-row"><label for="d${i}Loop">Loop<select id="d${i}Loop" aria-label="Deck ${i + 1} loop length"><option value="off">Off</option>${[0.5, 1, 2, 4, 8, 16, 32].map((n) => `<option value="${n}">${n} beat${n === 1 ? "" : "s"}</option>`).join("")}</select></label><output class="wb-effective" id="d${i}Effective">120.0 <small>BPM</small></output></div>
    <div class="wb-level-row"><label for="d${i}Gain"><span>LEVEL <output id="d${i}GainOut" for="d${i}Gain">65%</output></span><input id="d${i}Gain" type="range" min="0" max="1" step="0.01" value="0.65" aria-label="Deck ${i + 1} level" /></label><button id="d${i}Mute" type="button" aria-label="Mute deck ${i + 1}" aria-pressed="false" title="Mute deck ${i + 1}">${icon("mute")}</button><button id="d${i}Solo" class="wb-solo" type="button" aria-label="Solo deck ${i + 1}" aria-pressed="false" title="Solo deck ${i + 1}">${icon("solo")}</button></div>
    <div class="wb-footer"><label for="d${i}Assign">BUS<select id="d${i}Assign" aria-label="Deck ${i + 1} crossfader assignment"><option>A</option><option>THRU</option><option>B</option></select></label><button id="d${i}Edit" class="wb-edit" type="button" aria-expanded="false" aria-controls="d${i}Details" aria-label="Edit deck ${i + 1}" title="Edit deck ${i + 1}">${icon("sliders")}</button></div>
    <details id="d${i}Details" class="wb-detail"><summary aria-label="Tempo, EQ and filter" title="Tempo, EQ and filter">${icon("sliders")}</summary><div class="wb-detail-body"><div class="wb-source-tempo"><label for="d${i}Bpm">Source BPM<input id="d${i}Bpm" class="deck-bpm" type="number" min="40" max="240" step="0.1" value="120" aria-label="Deck ${i + 1} source BPM" /></label><button id="d${i}Match" type="button" title="Match the master tempo using this source BPM. Pitch follows speed." aria-label="Match deck ${i + 1} tempo">${icon("sync")}</button></div>
    ${range(i, "Rate", "Speed", 0.5, 2, 0.001, 1)}
    <div class="wb-eq">${["Low", "Mid", "High"].map((name) => range(i, name, name, -24, 12, 0.5, 0)).join("")}</div>
    ${range(i, "Filter", "Filter · low ↔ high", -1, 1, 0.01, 0)}
    ${range(i, "Pan", "Pan · left ↔ right", -1, 1, 0.01, 0)}
    </div></details>`;
  $("deckGrid").append(deck);
  on($(`d${i}Play`), "click", () => act(() => engine.toggle(i)));
  on($(`d${i}Cue`), "click", () => act(() => engine.cue(i)));
  on($(`d${i}SetCue`), "click", () => { engine.setCue(i); say(`Deck ${i + 1} cue saved at ${time(engine.getDeckState(i).cuePoint)}.`); });
  on($(`d${i}Load`), "click", () => $(`d${i}File`).click());
  on($(`d${i}File`), "change", (event) => { const file = event.target.files[0]; event.target.value = ""; if (file) act(() => importFile(i, file)); });
  on($(`d${i}Loop`), "change", (event) => act(() => engine.setLoop(i, event.target.value === "off" ? null : Number(event.target.value))));
  on($(`d${i}Seek`), "input", (event) => act(() => engine.seek(i, Number(event.target.value))));
  on($(`d${i}Seek`), "pointerdown", () => seeking.add(i));
  for (const type of ["pointerup", "pointercancel", "blur"]) on($(`d${i}Seek`), type, () => seeking.delete(i));
  for (const [key, field] of [["Gain", "gain"], ["Rate", "rate"], ["Bpm", "bpm"], ["Filter", "filter"], ["Pan", "pan"]]) {
    on($(`d${i}${key}`), "input", (event) => { if (event.target.value !== "" && Number.isFinite(event.target.valueAsNumber)) act(() => engine.setDeck(i, { [field]: event.target.valueAsNumber })); });
    on($(`d${i}${key}`), "change", render);
    on($(`d${i}${key}`), "blur", render);
  }
  for (const key of ["Low", "Mid", "High"]) on($(`d${i}${key}`), "input", (event) => act(() => engine.setDeck(i, { eq: { [key.toLowerCase()]: Number(event.target.value) } })));
  for (const key of ["Mute", "Solo"]) on($(`d${i}${key}`), "click", () => { const field = key.toLowerCase(); engine.setDeck(i, { [field]: !engine.getDeckState(i)[field] }); });
  on($(`d${i}Assign`), "change", (event) => engine.setDeck(i, { assignment: event.target.value }));
  on($(`d${i}Match`), "click", () => matchDeck(i));
  on($(`d${i}Edit`), "click", () => editDeck(i));
  on($(`d${i}Details`), "toggle", () => $(`d${i}Edit`).setAttribute("aria-expanded", String($(`d${i}Details`).open)));
  on(deck, "dragover", (event) => { if (event.dataTransfer.types.includes("Files")) { event.preventDefault(); deck.classList.add("is-dragover"); } });
  on(deck, "dragleave", (event) => { if (!deck.contains(event.relatedTarget)) deck.classList.remove("is-dragover"); });
  on(deck, "drop", (event) => { event.preventDefault(); deck.classList.remove("is-dragover"); const file = event.dataTransfer.files[0]; if (file) act(() => importFile(i, file)); });
  let pointer = null;
  const wave = $(`d${i}Wave`);
  const scrub = (event) => { const r = wave.getBoundingClientRect(); engine.seek(i, Math.min(1, Math.max(0, (event.clientX - r.left) / r.width)) * engine.getDeckState(i).duration); };
  on(wave, "pointerdown", (event) => { if (event.button !== 0) return; wave.focus({ preventScroll: true }); pointer = event.pointerId; wave.setPointerCapture(pointer); seeking.add(i); scrub(event); });
  on(wave, "pointermove", (event) => { if (event.pointerId === pointer) scrub(event); });
  on(wave, "keydown", (event) => {
    const d = engine.getDeckState(i), step = 60 / d.bpm * (event.shiftKey ? .1 : 1);
    const target = { ArrowLeft: d.position - step, ArrowRight: d.position + step, Home: 0, End: d.duration }[event.key];
    if (target !== undefined) { event.preventDefault(); engine.seek(i, target); }
  });
  for (const type of ["pointerup", "pointercancel", "lostpointercapture"]) on(wave, type, (event) => { if (event.pointerId !== pointer) return; pointer = null; seeking.delete(i); if (wave.hasPointerCapture(event.pointerId)) wave.releasePointerCapture(event.pointerId); });
  const platter = $(`d${i}Platter`);
  let hand = null, keyboardTarget = null, recordAngle = 0, recordPosition = 0;
  const rotateTo = (sourcePosition, delta = sourcePosition - recordPosition) => {
    recordAngle += delta / 1.8 * 360; recordPosition = sourcePosition;
    deck.querySelector(".wb-disc-needle").style.setProperty("--disc-angle", `${recordAngle}deg`);
  };
  const updateRecord = (d) => {
    if (hand || keyboardTarget !== null) return;
    let delta = d.position - recordPosition;
    if (d.playing && d.loopEnabled && delta < 0) delta += d.loopEnd - d.loopStart;
    rotateTo(d.position, delta);
  };
  const angle = (event) => { const r = platter.getBoundingClientRect(); return Math.atan2(event.clientY - r.top - r.height / 2, event.clientX - r.left - r.width / 2); };
  const release = () => {
    const pointerId = hand?.id;
    hand = null; keyboardTarget = null;
    engine.endScratch(i);
    if (pointerId !== undefined && platter.hasPointerCapture(pointerId)) platter.releasePointerCapture(pointerId);
  };
  on(platter, "pointerdown", (event) => {
    if (event.button !== 0 || hand) return;
    event.preventDefault(); platter.focus({ preventScroll: true });
    if (!engine.beginScratch(i)) return;
    recordPosition = engine.getDeckState(i).position;
    hand = { id: event.pointerId, angle: angle(event), position: recordPosition };
    keyboardTarget = null; platter.setPointerCapture(event.pointerId);
  });
  on(platter, "pointermove", (event) => {
    if (event.pointerId !== hand?.id) return;
    const next = angle(event), delta = Math.atan2(Math.sin(next - hand.angle), Math.cos(next - hand.angle));
    hand.position += delta / (Math.PI * 2) * 1.8; hand.angle = next;
    engine.scratchTo(i, hand.position);
    const d = engine.getDeckState(i);
    rotateTo(d.position, d.loopEnabled ? delta / (Math.PI * 2) * 1.8 : d.position - recordPosition);
    if (!d.loopEnabled) hand.position = d.position;
  });
  for (const type of ["pointerup", "pointercancel", "lostpointercapture"]) on(platter, type, (event) => { if (event.pointerId === hand?.id) release(); });
  on(platter, "keydown", (event) => {
    if (!["ArrowLeft", "ArrowRight"].includes(event.key) || hand) return;
    event.preventDefault(); event.stopPropagation();
    if (keyboardTarget === null) { if (!engine.beginScratch(i)) return; keyboardTarget = engine.getDeckState(i).position; }
    const step = (event.key === "ArrowLeft" ? -1 : 1) * (event.shiftKey ? .015 : .075);
    keyboardTarget += step;
    engine.scratchTo(i, keyboardTarget);
    const d = engine.getDeckState(i);
    rotateTo(d.position, d.loopEnabled ? step : d.position - recordPosition);
    if (!d.loopEnabled) keyboardTarget = d.position;
  });
  on(platter, "keyup", (event) => { if (["ArrowLeft", "ArrowRight"].includes(event.key) && keyboardTarget !== null) release(); });
  on(platter, "blur", () => { if (keyboardTarget !== null) release(); });
  on(window, "blur", release);
  on(document, "visibilitychange", () => { if (document.hidden) release(); });
  return { root: deck, wave, platter, release, updateRecord, recordWave: $(`d${i}RecordWave`), recordContext: $(`d${i}RecordWave`).getContext("2d"), disc: deck.querySelector(".wb-disc-needle"), context: wave.getContext("2d") };
});

function say(message) { if (!disposed) $("sessionStatus").textContent = message; }
function showError(error) { if (disposed || error?.name === "AbortError") return; $("errorMessage").textContent = error?.message ?? String(error); $("errorMessage").hidden = false; }
function act(fn) { $("errorMessage").hidden = true; try { Promise.resolve(fn()).catch(showError); } catch (error) { showError(error); } }
function time(seconds, decimal = true) { const units = decimal ? 10 : 1, s = Math.floor(Math.max(0, Number(seconds) || 0) * units) / units; return `${Math.floor(s / 60)}:${(s % 60).toFixed(decimal ? 1 : 0).padStart(decimal ? 4 : 2, "0")}`; }
function value(id, next) { const node = $(id); if (document.activeElement !== node || node.type !== "number") node.value = String(next); }
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
  try { const loaded = await engine.loadFile(i, file); if (loaded && !disposed) say(`Deck ${i + 1} loaded · Set its source BPM before matching tempo`); }
  catch (error) { say(`Deck ${i + 1} kept its previous sound`); throw error; }
  render();
}
function matchDeck(i) {
  const bpm = Number($("master-bpm").value) || 120;
  const source = engine.getDeckState(i).bpm;
  const requested = bpm / source;
  engine.setDeck(i, { rate: Math.min(2, Math.max(0.5, requested)) });
  say(requested < 0.5 || requested > 2 ? `Deck ${i + 1} reached its ½×–2× speed limit` : `Deck ${i + 1} matched to ${bpm} BPM · Pitch follows speed`);
}
function editDeck(i) {
  if (tiny) {
    selected = selected === i ? null : i;
    for (let j = 0; j < 8; j++) { cards[j].root.classList.toggle("is-selected", j === selected); $(`d${j}Details`).open = j === selected; }
  } else { $(`d${i}Details`).open = !$(`d${i}Details`).open; }
  render();
}
function setView(next) {
  for (const card of cards) card.release();
  view = next; tiny = next === "tiny"; selected = null;
  $("wobblini").classList.toggle("is-tiny", tiny);
  $("wobblini").classList.toggle("is-records", view === "records");
  for (const name of ["records", "full", "tiny"]) $(name + "View").setAttribute("aria-pressed", String(view === name));
  for (const [i, card] of cards.entries()) { card.root.classList.remove("is-selected"); $(`d${i}Details`).open = false; }
  render();
}
for (const name of ["records", "full", "tiny"]) on($(name + "View"), "click", () => setView(name));
on($("playButton"), "click", () => { const playing = engine.getState().decks.some((d) => d.playing); engine[playing ? "pauseAll" : "playAll"](); });
on($("stopButton"), "click", () => { for (const card of cards) card.release(); for (let i = 0; i < 8; i++) { engine.pause(i); engine.seek(i, 0); } say("Stopped · All decks at the beginning"); });
on($("matchAll"), "click", () => { for (let i = 0; i < 8; i++) matchDeck(i); say("Tempo matched from source BPM · Speed range ½×–2×"); });
on($("master-bpm"), "change", () => { $("master-bpm").value = Math.max(40, Math.min(240, Number($("master-bpm").value) || 120)); });
on($("loadDemos"), "click", () => act(async () => {
  if (engine.getState().decks.some((d) => d.kind === "file") && !await confirmReplace("Replace your loaded files on all eight decks with the original demo loops?")) return;
  if (disposed) return;
  for (let i = 0; i < 8; i++) engine.loadDemo(i);
  say("Original eight-loop demo set loaded");
}));
on($("resetMix"), "click", () => {
  for (let i = 0; i < 8; i++) engine.setDeck(i, { gain: initial.decks[i].gain, pan: 0, mute: false, solo: false, eq: { low: 0, mid: 0, high: 0 }, filter: 0, assignment: initial.decks[i].assignment });
  engine.setMaster({ crossfader: 0, wobbleAmount: 0, wobbleRate: 2 });
  say("Mixer reset · Files, tempo, loops and playback kept");
});
for (const [id, key] of [["crossfader", "crossfader"], ["recordCrossfader", "crossfader"], ["wobbleAmount", "wobbleAmount"], ["wobbleRate", "wobbleRate"]]) on($(id), "input", (event) => engine.setMaster({ [key]: Number(event.target.value) }));
on($("centerFade"), "click", () => engine.setMaster({ crossfader: 0 }));
on($("dryWobble"), "click", () => engine.setMaster({ wobbleAmount: 0 }));
on(window, "keydown", (event) => {
  if (event.repeat || event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey || event.isComposing || event.target.closest?.("input,button,select,textarea,a,summary,canvas,dialog,[contenteditable=true]")) return;
  if (/^[1-8]$/.test(event.key)) { event.preventDefault(); engine.toggle(Number(event.key) - 1); }
});

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
  const state = engine.getState(), count = state.decks.filter((d) => d.playing).length;
  if (!starting) strip.setAudioState(state.armed ? "on" : "off");
  $("playButton").setAttribute("aria-pressed", String(count > 0)); setIcon($("playButton"), count ? "pause" : "play", count ? "Pause all" : "Play all");
  $("activeDecks").value = `${count} / 8 playing`;
  $("liveDot").classList.toggle("is-on", state.armed && count > 0);
  for (let i = 0; i < 8; i++) {
    const d = state.decks[i];
    cards[i].root.classList.toggle("is-playing", d.playing); cards[i].root.classList.toggle("is-muted", d.mute || (state.decks.some((v) => v.solo) && !d.solo));
    $(`d${i}RecordName`).textContent = d.name;
    cards[i].root.classList.toggle("is-scratching", !!d.scratching);
    $(`d${i}Name`).textContent = d.name; $(`d${i}Name`).title = d.name;
    $(`d${i}Kind`).textContent = d.loading ? "Loading…" : d.kind === "file" ? "Local file · Manual BPM" : "Original demo loop";
    $(`d${i}Play`).setAttribute("aria-pressed", String(d.playing)); $(`d${i}Play`).setAttribute("aria-label", `${d.playing ? "Pause" : "Play"} deck ${i + 1}`); setIcon($(`d${i}Play`), d.playing ? "pause" : "play", `${d.playing ? "Pause" : "Play"} deck ${i + 1}`);
    $(`d${i}Mute`).setAttribute("aria-pressed", String(d.mute)); $(`d${i}Solo`).setAttribute("aria-pressed", String(d.solo));
    $(`d${i}Effective`).innerHTML = `${d.effectiveBpm.toFixed(1)} <small>BPM</small>`;
    $(`d${i}Seek`).max = String(d.duration || 1); $(`d${i}Duration`).value = time(d.duration, false);
    $(`d${i}Cue`).title = `Return to ${time(d.cuePoint)} and pause`;
    for (const [key, field] of [["Gain", "gain"], ["Rate", "rate"], ["Bpm", "bpm"], ["Pan", "pan"], ["Filter", "filter"], ["Assign", "assignment"]]) value(`d${i}${key}`, d[field]);
    value(`d${i}Loop`, d.loopEnabled ? d.loopBeats : "off");
    $(`d${i}GainOut`).value = `${Math.round(d.gain * 100)}%`; $(`d${i}RateOut`).value = `${d.rate.toFixed(3)}×`;
    for (const key of ["Low", "Mid", "High"]) { const n = d.eq[key.toLowerCase()]; value(`d${i}${key}`, n); $(`d${i}${key}Out`).value = `${n > 0 ? "+" : ""}${n.toFixed(1)} dB`; }
    $(`d${i}PanOut`).value = Math.abs(d.pan) < 0.01 ? "Center" : `${d.pan < 0 ? "L" : "R"} ${Math.round(Math.abs(d.pan) * 100)}%`;
    $(`d${i}FilterOut`).value = Math.abs(d.filter) < 0.01 ? "Open" : `${d.filter < 0 ? "Low" : "High"} ${Math.round(Math.abs(d.filter) * 100)}%`;
    setIcon($(`d${i}Edit`), tiny && selected === i ? "close" : "sliders", `${tiny && selected === i ? "Close" : "Edit"} deck ${i + 1}`);
  }
  for (const id of ["crossfader", "wobbleAmount", "wobbleRate"]) value(id, state.master[id]);
  value("recordCrossfader", state.master.crossfader);
  const fade = state.master.crossfader;
  $("crossfaderOut").value = Math.abs(fade) < .01 ? "Center" : `${fade < 0 ? "A" : "B"} ${Math.round(Math.abs(fade) * 100)}%`;
  $("wobbleAmountOut").value = `${Math.round(state.master.wobbleAmount * 100)}%`; $("wobbleRateOut").value = `${state.master.wobbleRate.toFixed(2)} Hz`;
  for (const side of ["A", "B"]) $("bus" + side).textContent = state.decks.filter((d) => d.assignment === side).map((d) => d.id + 1).join(" · ") || "No decks";
}

function prepareCanvas(canvas, ctx) {
  const r = canvas.getBoundingClientRect(), scale = Math.min(2, window.devicePixelRatio || 1);
  const width = Math.max(1, Math.round(r.width * scale)), height = Math.max(1, Math.round(r.height * scale));
  if (canvas.width !== width || canvas.height !== height) { canvas.width = width; canvas.height = height; }
  ctx.setTransform(scale, 0, 0, scale, 0, 0); ctx.clearRect(0, 0, r.width, r.height);
  return [r.width, r.height];
}
function drawWave(card, d, color) {
  const ctx = card.context, [w, h] = prepareCanvas(card.wave, ctx);
  if (d.loopEnabled && d.duration) { ctx.fillStyle = color + "18"; ctx.fillRect(d.loopStart / d.duration * w, 0, (d.loopEnd - d.loopStart) / d.duration * w, h); }
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
  const cx = w / 2, cy = h / 2, radius = Math.min(w, h) * .405;
  const count = Math.min(240, Math.max(80, Math.floor(w))), peaks = d.peaks || [];
  const progress = d.duration ? d.position / d.duration : 0;
  ctx.lineWidth = Math.max(1, w / 240); ctx.strokeStyle = color;
  // Batch the played/unplayed bars into two strokes per deck.
  for (const played of [false, true]) {
    ctx.globalAlpha = played ? .95 : .38; ctx.beginPath();
    for (let n = 0; n < count; n++) {
      if ((n / count <= progress) !== played) continue;
      const angle = n / count * Math.PI * 2 - Math.PI / 2;
      const peak = Math.min(1, Math.abs(peaks[Math.floor(n / count * peaks.length)] || 0));
      const amplitude = Math.max(.6, peak * Math.min(w, h) * .06);
      ctx.moveTo(cx + Math.cos(angle) * (radius - amplitude), cy + Math.sin(angle) * (radius - amplitude));
      ctx.lineTo(cx + Math.cos(angle) * (radius + amplitude), cy + Math.sin(angle) * (radius + amplitude));
    }
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
  const angle = progress * Math.PI * 2 - Math.PI / 2;
  ctx.fillStyle = "#f1f8fc"; ctx.beginPath(); ctx.arc(cx + Math.cos(angle) * radius, cy + Math.sin(angle) * radius, Math.max(2, w * .01), 0, Math.PI * 2); ctx.fill();
  if (d.loopEnabled && d.duration) {
    ctx.strokeStyle = color; ctx.lineWidth = 1; ctx.globalAlpha = .5; ctx.beginPath();
    ctx.arc(cx, cy, Math.min(w, h) * .48, d.loopStart / d.duration * Math.PI * 2 - Math.PI / 2, d.loopEnd / d.duration * Math.PI * 2 - Math.PI / 2); ctx.stroke(); ctx.globalAlpha = 1;
  }
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
  if (!document.hidden && now - lastDraw >= 1000 / 30) {
    lastDraw = now; const state = engine.getState();
    for (let i = 0; i < 8; i++) { const d = state.decks[i]; if (view !== "records") drawWave(cards[i], d, colors[i]);
      else drawRecordWave(cards[i], d, colors[i]);
      cards[i].updateRecord(d);
      cards[i].platter.setAttribute("aria-valuemax", String(d.duration));
      cards[i].platter.setAttribute("aria-valuenow", d.position.toFixed(2));
      cards[i].platter.setAttribute("aria-valuetext", `${time(d.position)} of ${time(d.duration)}`); $(`d${i}Time`).value = time(d.position); if (!seeking.has(i) && document.activeElement !== $(`d${i}Seek`)) $(`d${i}Seek`).value = String(d.position); }
    if (view !== "records") drawPad(state);
    const count = state.decks.filter((d) => d.playing).length;
    if ($("activeDecks").value !== `${count} / 8 playing`) render();
  }
  frame = requestAnimationFrame(animate);
}
async function dispose() {
  if (disposed) return; disposed = true; audioAttempt++; abort.abort(); cancelAnimationFrame(frame); confirmation?.(false); confirmation = null;
  tapIcons.disconnect(); strip.destroy?.(); await engine.dispose();
}
on(window, "pagehide", (event) => {
  // A back-forward-cache restoration needs a fresh engine after this teardown.
  // Keep only this one-shot restoration listener outside the aborted lifecycle.
  if (event.persisted) window.addEventListener("pageshow", () => window.location.reload(), { once: true });
  void dispose();
});
initialized = true; render(); frame = requestAnimationFrame(animate);

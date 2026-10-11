import { createAudioStrip } from "../../ui/patterns/audio-strip.js";
import { TrackazoidAudio } from "./audio.js";
import { TrackLibrary } from "./library.js";
import { WaveformView, formatTime, beatLoop, syncTarget } from "./waveform.js";

const $ = (id) => document.getElementById(id);
const abort = new AbortController();
const on = (target, event, fn, options = {}) => target.addEventListener(event, fn, { ...options, signal: abort.signal });
const decks = Object.fromEntries(["a", "b"].map((id) => [id, {
  entry: null, metadata: { bpm: 120, beatOffset: 0, cues: [null, null, null, null] },
  pending: null, revision: 0, intent: 0, loading: false, keyPending: false, monitor: false,
}]));
let initialized = false, disposed = false, audioStarting = false, audioAttempt = 0;
let selected = "a", folderFilter = null, visibleLimit = 150, pickerDeck = null;
let frame = 0, lastFrame = 0, libraryRender = 0, settingsTimer = 0, decodeQueue = Promise.resolve();
let libraryEntries = [], entryIndex = new Map();
const engine = new TrackazoidAudio({ onError: showError, onChange: () => { if (initialized) updateDecks(); } });
const library = new TrackLibrary({ onChange: scheduleLibrary, onStatus: (message) => {
  if (!disposed) { $("libraryStatus").textContent = message; $("cancelImport").hidden = !library.importing; }
} });
const strip = createAudioStrip({ buttonId: "audioButton", levelId: "level", level: 0.65, min: 0, max: 1, step: 0.01,
  onAudioClick: toggleAudio, onLevelInput: (value) => { engine.setMaster(value); saveSettings(); } });
$("audioSlot").replaceWith(strip);
engine.setMaster(0.65);
const views = Object.fromEntries(["a", "b"].map((id) => [id, new WaveformView($(`${id}Waveform`), $(`${id}Overview`), {
  color: id === "a" ? "#72e1cd" : "#f6b57c", getState: () => ({ ...engine.snapshot(id), ...decks[id].metadata }),
  seek: (position) => seek(id, position), changeLoop: (start, end) => act(() => engine.setLoop(id, start, end)), onError: showError,
})]));

function showError(error) {
  if (disposed || error?.name === "AbortError") return;
  $("errorMessage").textContent = error?.message || String(error);
  $("errorMessage").hidden = false;
  if (initialized && !engine.armed && !audioStarting) strip.setAudioState("off");
}
function clearError() { $("errorMessage").hidden = true; }
function status(message) { if (!disposed) $("sessionStatus").textContent = message; }
function act(fn) { try { Promise.resolve(fn()).catch(showError); } catch (error) { showError(error); } }
function entryById(id) { return entryIndex.get(id); }
function selectDeck(id) {
  selected = id;
  for (const key of ["a", "b"]) $(`deck${key.toUpperCase()}`).classList.toggle("is-selected", key === id);
}

async function toggleAudio() {
  clearError();
  const attempt = ++audioAttempt;
  if (engine.armed || audioStarting) {
    audioStarting = false; strip.setAudioState("off");
    await engine.setAudio(false);
    if (!disposed && attempt === audioAttempt) status("Audio off · deck transport is preserved.");
    return;
  }
  audioStarting = true; strip.setAudioState("starting");
  try {
    await engine.setAudio(true);
    if (disposed || attempt !== audioAttempt) return;
    strip.setAudioState(engine.armed ? "on" : "off");
    status(engine.armed ? "Audio on · your decks are ready." : "Audio could not start. Try the Audio control again.");
  } catch (error) {
    if (attempt !== audioAttempt) return;
    strip.setAudioState("error"); showError(error);
  } finally { if (attempt === audioAttempt) audioStarting = false; }
}

function scheduleLibrary() {
  libraryEntries = library.entries;
  entryIndex = new Map(libraryEntries.map((entry) => [entry.id, entry]));
  if (disposed || libraryRender) return;
  libraryRender = requestAnimationFrame(() => { libraryRender = 0; renderLibrary(); });
}
function renderLibrary() {
  if (disposed) return;
  const entries = libraryEntries;
  const query = $("librarySearch").value.trim().toLocaleLowerCase();
  const filtered = entries.filter((entry) => (!folderFilter || entry.folderId === folderFilter)
    && (!query || `${entry.name} ${entry.path} ${entry.folder}`.toLocaleLowerCase().includes(query)));
  const rows = document.createDocumentFragment();
  for (const entry of filtered.slice(0, visibleLimit)) {
    const row = document.createElement("tr");
    row.draggable = entry.available; row.dataset.trackId = entry.id;
    row.classList.toggle("is-loaded", Object.values(decks).some((deck) => deck.entry === entry.id));
    const values = [entry.name, entry.folder || "Files", entry.metadata.duration ? entry.metadata.bpm.toFixed(1) : "—", entry.metadata.duration ? formatTime(entry.metadata.duration) : "—"];
    for (const value of values) { const td = document.createElement("td"); td.textContent = value; td.title = value; row.append(td); }
    const controls = document.createElement("td");
    for (const id of ["a", "b"]) {
      const button = document.createElement("button"); button.type = "button";
      button.textContent = id.toUpperCase(); button.dataset.deck = id;
      button.setAttribute("aria-label", `Load ${entry.name} into deck ${id.toUpperCase()}`);
      // Unavailable rows remain actionable so reconnect instructions are reachable.
      if (!entry.available) button.title = "Reconnect the folder or add this file again";
      controls.append(button);
    }
    if (!entry.available) { row.classList.add("tz-unavailable"); row.title = "Reconnect folder or re-add this file to load it"; }
    row.append(controls); rows.append(row);
  }
  $("trackRows").replaceChildren(rows);
  $("trackCount").textContent = `${entries.length.toLocaleString()} ${entries.length === 1 ? "track" : "tracks"}`;
  $("libraryEmpty").hidden = entries.length > 0;
  $("libraryTableWrap").hidden = entries.length === 0;
  $("libraryVisible").textContent = entries.length ? `${Math.min(visibleLimit, filtered.length).toLocaleString()} of ${filtered.length.toLocaleString()} shown` : "";
  $("showMore").hidden = filtered.length <= visibleLimit;
  $("cancelImport").hidden = !library.importing;
  $("allTracks").setAttribute("aria-pressed", String(!folderFilter));
  const folders = document.createDocumentFragment();
  for (const folder of library.folders) {
    const group = document.createElement("div"); group.className = "tz-folder"; group.dataset.folderId = folder.id;
    const choose = document.createElement("button"); choose.type = "button"; choose.textContent = folder.name; choose.title = folder.name;
    choose.dataset.action = "filter"; choose.setAttribute("aria-pressed", String(folderFilter === folder.id));
    const reconnect = document.createElement("button"); reconnect.type = "button";
    reconnect.textContent = folder.connected ? "↻" : "Reconnect";
    reconnect.dataset.action = folder.connected ? "refresh" : "reconnect";
    reconnect.setAttribute("aria-label", `${folder.connected ? "Refresh" : "Reconnect"} folder ${folder.name}`);
    group.append(choose, reconnect); folders.append(group);
  }
  $("folderList").replaceChildren(folders);
}

async function importFiles(files, targetDeck = null) {
  clearError();
  const intent = targetDeck ? ++decks[targetDeck].intent : null;
  await libraryReady;
  if (disposed) return;
  const ids = await library.addFiles(files);
  if (disposed) return;
  if (!ids.length) { status("No supported audio files found. Try WAV, MP3 or FLAC."); return; }
  if (targetDeck) { if (intent === decks[targetDeck].intent) await requestLoad(targetDeck, ids[0]); }
  else status(`${ids.length} ${ids.length === 1 ? "track added" : "tracks added"} · choose A or B to load a deck.`);
}

async function requestLoad(id, entryId, replace = false) {
  const entry = entryById(entryId); if (!entry || disposed) return;
  const deck = decks[id];
  deck.intent++;
  if (engine.snapshot(id).playing && !replace) {
    deck.pending = entryId; updateDecks();
    status(`Deck ${id.toUpperCase()} keeps playing. Its replacement is ready when you are.`); return;
  }
  if (replace) engine.pause(id);
  const revision = ++deck.revision;
  deck.loading = true; deck.pending = null; clearError(); updateDecks();
  try {
    const file = await library.getFile(entryId);
    if (file.size > 160 * 1024 * 1024) throw new Error("This file is larger than the MVP’s 160 MB file limit. Choose a shorter or compressed track.");
    // Serialize decodes to bound transient memory during simultaneous imports.
    const decode = decodeQueue.catch(() => {}).then(async () => {
      if (disposed || revision !== deck.revision) return null;
      const bytes = await file.arrayBuffer();
      if (disposed || revision !== deck.revision) return null;
      const Decoder = globalThis.OfflineAudioContext || globalThis.webkitOfflineAudioContext;
      if (!Decoder) throw new Error("This browser cannot decode tracks without starting audio. Try desktop Chrome or Edge.");
      const decoder = new Decoder(2, 1, 48000);
      let buffer;
      try { buffer = await decoder.decodeAudioData(bytes); }
      catch { throw new Error(`“${file.name}” could not be decoded. Try a standard WAV, MP3 or FLAC file.`); }
      if (buffer.length * buffer.numberOfChannels * 4 > 256 * 1024 * 1024) throw new Error("This track needs more than 256 MB of playback memory. Choose a shorter track for this MVP.");
      return buffer;
    });
    decodeQueue = decode.then(() => {}, () => {});
    const buffer = await decode;
    if (!buffer || disposed || revision !== deck.revision) return;
    // load commits the decoded buffer synchronously, then prepares optional DSP.
    // Commit its visible identity in the same turn, even if a later request fails.
    const loaded = engine.load(id, buffer);
    deck.entry = entryId;
    deck.metadata = { ...entry.metadata, bpm: Math.min(240, Math.max(40, entry.metadata.bpm)), duration: buffer.duration, cues: [...entry.metadata.cues] };
    $(`${id}Bpm`).value = String(deck.metadata.bpm);
    act(() => library.updateMetadata(entryId, deck.metadata));
    void views[id].setBuffer(buffer);
    selectDeck(id);
    await loaded;
    if (disposed || revision !== deck.revision) return;
    status(`Deck ${id.toUpperCase()} loaded · ${file.name}${engine.armed ? "" : " · Audio is off"}`);
  } catch (error) { if (revision === deck.revision && !disposed) showError(error); }
  finally { if (revision === deck.revision) { deck.loading = false; updateDecks(); scheduleLibrary(); } }
}

function saveMetadata(id, patch) {
  const deck = decks[id]; deck.metadata = { ...deck.metadata, ...patch };
  if (deck.entry) act(() => library.updateMetadata(deck.entry, patch));
}
function togglePlay(id) {
  if (!decks[id].entry || decks[id].loading) return;
  selectDeck(id); clearError();
  const snapshot = engine.snapshot(id);
  if (snapshot.playing) engine.pause(id); else engine.play(id);
  if (!engine.armed) status("Transport is moving silently. Turn Audio on to hear the mix.");
  updateDecks();
}
function seek(id, position) {
  if (!decks[id].entry) return;
  selectDeck(id);
  const snapshot = engine.snapshot(id);
  if (snapshot.loop && (position < snapshot.loop.start || position >= snapshot.loop.end)) engine.clearLoop(id);
  engine.seek(id, position); updateDecks();
}
function hotCue(id, index, clear = false) {
  if (!decks[id].entry || decks[id].loading) return;
  const cues = [...decks[id].metadata.cues];
  if (clear) { cues[index] = null; saveMetadata(id, { cues }); }
  else if (cues[index] === null) { cues[index] = engine.snapshot(id).position; saveMetadata(id, { cues }); }
  else seek(id, cues[index]);
  updateDecks();
}
function toggleLoop(id, resize = false) {
  const snapshot = engine.snapshot(id); if (!snapshot.duration) return;
  if (snapshot.loop && !resize) engine.clearLoop(id);
  else {
    const { bpm, beatOffset } = decks[id].metadata;
    const loop = beatLoop(snapshot.loop?.start ?? snapshot.position, bpm, beatOffset, Number($(`${id}LoopBeats`).value), snapshot.duration);
    if (loop) { engine.setLoop(id, loop.start, loop.end); if (snapshot.position >= loop.end) engine.seek(id, loop.start); }
  }
  updateDecks();
}
function sync(id) {
  const other = id === "a" ? "b" : "a";
  if (!decks[id].entry || !decks[other].entry) { status("Load both decks before syncing."); return; }
  const source = engine.snapshot(id), reference = engine.snapshot(other);
  const target = syncTarget({ position: source.position, duration: source.duration, bpm: decks[id].metadata.bpm, offset: decks[id].metadata.beatOffset,
    otherPosition: reference.position, otherBpm: decks[other].metadata.bpm, otherOffset: decks[other].metadata.beatOffset, otherRate: reference.rate });
  if (!target) { status("Sync needs more than ±16% tempo. Check each track’s source BPM or adjust the other deck."); return; }
  engine.setRate(id, target.rate); seek(id, target.position);
  $(`${id}Tempo`).value = String((target.rate - 1) * 100);
  status(`Deck ${id.toUpperCase()} matched to ${other.toUpperCase()} · Sync uses your source BPM and downbeat.`); updateDecks();
}

function updateDecks() {
  if (disposed) return;
  for (const id of ["a", "b"]) {
    const deck = decks[id], state = engine.snapshot(id), letter = id.toUpperCase();
    const entry = entryById(deck.entry);
    $(`${id}Title`).textContent = entry?.name || "Load a track";
    $(`${id}Title`).title = entry?.name || "";
    $(`${id}Info`).textContent = deck.loading ? "Decoding track…" : entry ? `${entry.folder || "Local file"} · ${formatTime(state.duration)}` : "Drop a file or choose one from your library";
    $(`${id}Position`).value = formatTime(state.position);
    $(`${id}Remaining`).value = `−${formatTime(Math.max(0, state.duration - state.position))}`;
    $(`${id}State`).textContent = deck.loading ? "LOADING" : !entry ? "EMPTY" : state.playing ? engine.armed ? "PLAYING" : "SILENT PLAY" : "READY";
    $(`${id}Play`).setAttribute("aria-pressed", String(state.playing));
    $(`${id}Play`).setAttribute("aria-label", `${state.playing ? "Pause" : "Play"} deck ${letter}`);
    const playLabel = state.playing ? "Ⅱ <span>Pause</span>" : "▶ <span>Play</span>";
    if ($(`${id}Play`).innerHTML !== playLabel) $(`${id}Play`).innerHTML = playLabel;
    for (const key of ["Play", "Cue", "NudgeBack", "NudgeForward", "Sync", "Loop", "Grid", "HotCue1", "HotCue2", "HotCue3", "HotCue4"]) $(`${id}${key}`).disabled = !entry || deck.loading;
    $(`${id}Effective`).value = (deck.metadata.bpm * state.rate).toFixed(1);
    $(`${id}TempoOut`).value = `${state.rate >= 1 ? "+" : ""}${((state.rate - 1) * 100).toFixed(1)}%`;
    if (document.activeElement !== $(`${id}Tempo`)) $(`${id}Tempo`).value = String((state.rate - 1) * 100);
    $(`${id}KeyLock`).setAttribute("aria-pressed", String(state.keyLock));
    $(`${id}KeyLock`).disabled = deck.keyPending;
    $(`${id}Loop`).setAttribute("aria-pressed", String(Boolean(state.loop)));
    $(`${id}GridInfo`).textContent = `Grid: ${formatTime(deck.metadata.beatOffset)} · manual BPM`;
    for (let index = 0; index < 4; index++) $(`${id}HotCue${index + 1}`).classList.toggle("has-cue", deck.metadata.cues[index] !== null);
    $(`${id}Pending`).hidden = !deck.pending;
    $(`${id}PendingName`).textContent = deck.pending ? entryById(deck.pending)?.name || "Track ready" : "";
    $(`${id}Monitor`).setAttribute("aria-pressed", String(deck.monitor));
  }
}

for (const id of ["a", "b"]) {
  const node = $(`deck${id.toUpperCase()}`);
  on(node, "pointerdown", () => selectDeck(id));
  on(node, "focusin", () => selectDeck(id));
  on($(`${id}Play`), "click", () => act(() => togglePlay(id)));
  on($(`${id}Cue`), "click", () => { engine.pause(id); seek(id, decks[id].metadata.cues[0] ?? 0); });
  on($(`${id}NudgeBack`), "click", () => seek(id, engine.snapshot(id).position - 0.02));
  on($(`${id}NudgeForward`), "click", () => seek(id, engine.snapshot(id).position + 0.02));
  on($(`${id}Sync`), "click", () => act(() => sync(id)));
  on($(`${id}Tempo`), "input", (event) => { engine.setRate(id, 1 + Number(event.target.value) / 100); updateDecks(); });
  on($(`${id}TempoReset`), "click", (event) => { event.preventDefault(); engine.setRate(id, 1); $(`${id}Tempo`).value = "0"; updateDecks(); });
  on($(`${id}Bpm`), "input", (event) => {
    const bpm = Number(event.target.value);
    if (Number.isFinite(bpm) && bpm >= 40 && bpm <= 240) { saveMetadata(id, { bpm }); updateDecks(); }
  });
  on($(`${id}Bpm`), "change", (event) => { event.target.value = String(decks[id].metadata.bpm); });
  on($(`${id}KeyLock`), "click", () => act(async () => {
    decks[id].keyPending = true; updateDecks();
    try { await engine.setKeyLock(id, !engine.snapshot(id).keyLock); }
    finally { decks[id].keyPending = false; updateDecks(); }
  }));
  for (let index = 0; index < 4; index++) on($(`${id}HotCue${index + 1}`), "click", (event) => hotCue(id, index, event.shiftKey));
  on($(`${id}Loop`), "click", () => act(() => toggleLoop(id)));
  on($(`${id}LoopBeats`), "change", () => { if (engine.snapshot(id).loop) act(() => toggleLoop(id, true)); });
  on($(`${id}Grid`), "click", () => { saveMetadata(id, { beatOffset: engine.snapshot(id).position }); updateDecks(); });
  on($(`${id}Load`), "click", () => { pickerDeck = id; $("filePicker").click(); });
  on($(`${id}Replace`), "click", () => act(() => requestLoad(id, decks[id].pending, true)));
  on($(`${id}Cancel`), "click", () => { decks[id].pending = null; updateDecks(); });
  on($(`${id}Monitor`), "click", () => {
    decks[id].monitor = !decks[id].monitor; engine.setCue(id, decks[id].monitor); updateDecks();
    if (decks[id].monitor && $("outputMode").value === "stereo") status("Cue selected. Choose Split cue monitoring to hear it on the right output.");
  });
  for (const band of ["high", "mid", "low"]) on($(`${id}${band}`), "input", (event) => {
    const value = Number(event.target.value); engine.setEQ(id, band, value);
    event.target.parentElement.querySelector("output").value = `${value > 0 ? "+" : ""}${value} dB`; saveSettings();
  });
  on($(`${id}Gain`), "input", (event) => { const value = Number(event.target.value); engine.setGain(id, value); event.target.parentElement.querySelector("output").value = `${Math.round(value * 100)}%`; saveSettings(); });
  on($(`${id}Filter`), "input", (event) => {
    const value = Number(event.target.value); engine.setFilter(id, value);
    event.target.parentElement.querySelector("output").value = Math.abs(value) < 0.01 ? "Open" : `${value < 0 ? "Low" : "High"} ${Math.round(Math.abs(value) * 100)}%`; saveSettings();
  });
}
on($("crossfader"), "input", (event) => { engine.setCrossfader(Number(event.target.value)); saveSettings(); });
on($("cueLevel"), "input", (event) => { engine.setCueLevel(Number(event.target.value)); saveSettings(); });
on($("outputMode"), "change", (event) => {
  engine.setRouting(event.target.value);
  status(event.target.value === "split" ? "Split cue: master left, headphones right. Use a DJ splitter cable; both outputs are mono." : "Stereo master output.");
});
on($("resetMixer"), "click", () => {
  for (const id of ["a", "b"]) {
    for (const key of ["high", "mid", "low", "Filter", "Gain"]) { const field = $(`${id}${key}`); field.value = key === "Gain" ? "0.8" : "0"; field.dispatchEvent(new Event("input", { bubbles: true })); }
  }
  $("crossfader").value = "0"; engine.setCrossfader(0); saveSettings(); status("Mixer reset · deck playback is preserved.");
});

on($("addFiles"), "click", () => { pickerDeck = null; $("filePicker").click(); });
on($("filePicker"), "change", (event) => { const files = [...event.target.files], target = pickerDeck; event.target.value = ""; pickerDeck = null; act(() => importFiles(files, target)); });
on($("filePicker"), "cancel", () => { pickerDeck = null; });
on($("folderPicker"), "change", (event) => { const files = [...event.target.files]; event.target.value = ""; act(() => importFiles(files)); });
on($("openFolder"), "click", () => {
  clearError();
  if (typeof globalThis.showDirectoryPicker === "function") act(() => library.openFolder());
  else $("folderPicker").click();
});
on($("cancelImport"), "click", () => { library.cancelImport(); $("cancelImport").hidden = true; });
on($("librarySearch"), "input", () => { visibleLimit = 150; scheduleLibrary(); });
on($("allTracks"), "click", () => { folderFilter = null; visibleLimit = 150; scheduleLibrary(); });
on($("showMore"), "click", () => { visibleLimit += 150; scheduleLibrary(); });
on($("folderList"), "click", (event) => {
  const button = event.target.closest("button"); if (!button) return;
  const folderId = button.closest("[data-folder-id]").dataset.folderId;
  if (button.dataset.action === "filter") { folderFilter = folderId; visibleLimit = 150; scheduleLibrary(); }
  else act(() => button.dataset.action === "refresh" ? library.refresh(folderId) : library.reconnect(folderId));
});
on($("trackRows"), "click", (event) => {
  const button = event.target.closest("button[data-deck]"); if (!button) return;
  act(() => requestLoad(button.dataset.deck, button.closest("[data-track-id]").dataset.trackId));
});
on($("trackRows"), "dragstart", (event) => {
  const row = event.target.closest("[data-track-id]"); if (!row) return;
  event.dataTransfer.setData("application/x-trackazoid-track", row.dataset.trackId);
  event.dataTransfer.effectAllowed = "copy";
});
for (const [element, targetDeck] of [[$("deckA"), "a"], [$("deckB"), "b"], [$("libraryDrop"), null]]) {
  on(element, "dragover", (event) => {
    if (![...event.dataTransfer.types].some((type) => ["Files", "application/x-trackazoid-track"].includes(type))) return;
    event.preventDefault(); event.dataTransfer.dropEffect = "copy"; element.classList.add("is-dragover");
  });
  on(element, "dragleave", (event) => { if (!element.contains(event.relatedTarget)) element.classList.remove("is-dragover"); });
  on(element, "drop", (event) => {
    event.preventDefault(); element.classList.remove("is-dragover");
    const entryId = event.dataTransfer.getData("application/x-trackazoid-track");
    if (entryId && targetDeck) { act(() => requestLoad(targetDeck, entryId)); return; }
    const files = [...event.dataTransfer.files];
    if (files.length) act(() => importFiles(files, targetDeck));
    else status("Use Open folder to browse a music directory.");
  });
}
on(window, "dragover", (event) => { if ([...event.dataTransfer.types].includes("Files")) event.preventDefault(); });
on(window, "drop", (event) => { if ([...event.dataTransfer.types].includes("Files")) event.preventDefault(); });
on(document, "keydown", (event) => {
  if (event.ctrlKey || event.metaKey || event.altKey || event.repeat) return;
  if (event.key === "Escape") { engine.pause("a"); engine.pause("b"); updateDecks(); return; }
  if (event.target.closest("input, select, textarea, button, summary, [contenteditable=true], dialog, canvas")) return;
  const key = event.key.toLowerCase();
  if (key === "a" || key === "b") { selectDeck(key); event.preventDefault(); }
  else if (event.code === "Space") { event.preventDefault(); act(() => togglePlay(selected)); }
  else if (key === "l") { event.preventDefault(); act(() => toggleLoop(selected)); }
  else if (/^[1-4]$/.test(key)) { event.preventDefault(); hotCue(selected, Number(key) - 1, event.shiftKey); }
});

function saveSettings() {
  clearTimeout(settingsTimer);
  settingsTimer = setTimeout(() => {
    const values = Object.fromEntries(["level", "crossfader", "cueLevel", ...["a", "b"].flatMap((id) => ["high", "mid", "low", "Filter", "Gain"].map((key) => `${id}${key}`))].map((id) => [id, Number($(id).value)]));
    try { localStorage.setItem("morphazoid-trackazoid-mixer-v1", JSON.stringify({ version: 1, values })); }
    catch { /* Live mixing still works when browser storage is unavailable. */ }
  }, 200);
}
function restoreSettings() {
  try {
    const saved = JSON.parse(localStorage.getItem("morphazoid-trackazoid-mixer-v1") || "null");
    if (saved?.version !== 1) return;
    const allowed = new Set(["level", "crossfader", "cueLevel", ...["a", "b"].flatMap((id) => ["high", "mid", "low", "Filter", "Gain"].map((key) => `${id}${key}`))]);
    for (const [id, value] of Object.entries(saved.values || {})) {
      const field = $(id);
      if (!allowed.has(id) || !field || field.type !== "range" || !Number.isFinite(value)) continue;
      field.value = String(Math.min(Number(field.max), Math.max(Number(field.min), value)));
      field.dispatchEvent(new Event("input", { bubbles: true }));
    }
  } catch { /* Use audible, moderate defaults after a corrupt saved setting. */ }
}

function demoFile(bpm, variant) {
  const sampleRate = 24000, duration = 32 * 60 / bpm, frames = Math.ceil(duration * sampleRate);
  const bytes = new ArrayBuffer(44 + frames * 4), view = new DataView(bytes);
  const text = (offset, value) => { [...value].forEach((char, i) => view.setUint8(offset + i, char.charCodeAt(0))); };
  text(0, "RIFF"); view.setUint32(4, 36 + frames * 4, true); text(8, "WAVE"); text(12, "fmt ");
  view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 2, true); view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 4, true); view.setUint16(32, 4, true); view.setUint16(34, 16, true); text(36, "data"); view.setUint32(40, frames * 4, true);
  let seed = 123456 + variant;
  for (let i = 0; i < frames; i++) {
    const t = i / sampleRate, beat = t * bpm / 60, phase = (beat % 1) * 60 / bpm;
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    const noise = seed / 2147483648 - 1;
    const kick = Math.sin(2 * Math.PI * (46 * phase + 9 * (1 - Math.exp(-phase * 30)))) * Math.exp(-phase * 18) * 0.43;
    const hatPhase = (beat * 2 % 1) * 30 / bpm;
    const hat = noise * Math.exp(-hatPhase * 150) * 0.1;
    const note = [55, 55, 65.4, 49][Math.floor(beat / 2) % 4] * (variant ? 1.5 : 1);
    const bass = Math.sin(2 * Math.PI * note * t) * Math.exp(-phase * 6) * 0.16;
    const chimePhase = (beat % 2) * 60 / bpm;
    const chime = Math.sin(2 * Math.PI * (variant ? 660 : 440) * t) * Math.exp(-chimePhase * 5) * 0.045;
    const fade = Math.min(1, t / 0.003, (duration - t) / 0.01);
    const value = (kick + hat + bass + chime) * fade;
    view.setInt16(44 + i * 4, Math.round(Math.max(-1, Math.min(1, value)) * 32767), true);
    view.setInt16(46 + i * 4, Math.round(Math.max(-1, Math.min(1, value - chime * 0.5)) * 32767), true);
  }
  return new File([bytes], `${variant ? "Amber circuit" : "Mint transmission"} — ${bpm} BPM.wav`, { type: "audio/wav", lastModified: 1 });
}
on($("demoPair"), "click", () => act(async () => {
  $("demoPair").disabled = true;
  try {
    const ids = await library.addFiles([demoFile(120, 0), demoFile(126, 1)], { folderName: "Trackazoid demos", folderId: "demo" });
    for (let index = 0; index < ids.length; index++) await library.updateMetadata(ids[index], { bpm: index ? 126 : 120, beatOffset: 0 });
    await requestLoad("a", ids[0]); await requestLoad("b", ids[1]);
    status("Demo pair ready · turn Audio on, then play a deck. Set a loop to keep mixing.");
  } finally { if (!disposed) $("demoPair").disabled = false; }
}));

function animate(time) {
  if (disposed) return;
  if (!document.hidden && time - lastFrame >= 33) {
    lastFrame = time; updateDecks(); views.a.draw(); views.b.draw();
  }
  frame = requestAnimationFrame(animate);
}
async function dispose() {
  if (disposed) return;
  disposed = true; audioAttempt++; decks.a.revision++; decks.b.revision++;
  cancelAnimationFrame(frame); cancelAnimationFrame(libraryRender); clearTimeout(settingsTimer);
  abort.abort(); views.a.destroy(); views.b.destroy(); library.dispose(); strip.destroy();
  await engine.dispose();
}
on(window, "pagehide", () => { void dispose(); });
// This listener must survive teardown to recover a restored back/forward page.
window.addEventListener("pageshow", (event) => { if (event.persisted && disposed) location.reload(); });
globalThis.__trackazoid = Object.freeze({
  snapshot: () => ({ armed: engine.armed, selected, disposed, contextState: engine.context?.state ?? "none",
    decks: Object.fromEntries(["a", "b"].map((id) => [id, { ...engine.snapshot(id), entry: decks[id].entry, pending: decks[id].pending, loading: decks[id].loading, metadata: { ...decks[id].metadata, cues: [...decks[id].metadata.cues] } }])),
    library: library.entries.map(({ id, name, available, metadata }) => ({ id, name, available, metadata })), folders: library.folders }),
  dispose,
});
initialized = true; restoreSettings(); selectDeck("a"); updateDecks();
const importControls = ["addFiles", "openFolder", "demoPair", "aLoad", "bLoad"];
for (const id of importControls) $(id).disabled = true;
const libraryReady = library.init().then(() => {
  if (disposed) return;
  for (const id of importControls) $(id).disabled = false;
  $("trackazoid").dataset.ready = "true";
}).catch(showError);
frame = requestAnimationFrame(animate);

import {
  VOCALZOID_DEFAULT_WORD,
  VOCALZOID_MAX_MIDI,
  VOCALZOID_MELODY_PRESETS,
  VOCALZOID_MIN_MIDI,
  VOCALZOID_STYLES,
  applyVocalzoidMelody,
  clampVocalzoid,
  createRandomVocalzoidScore,
  createVocalzoidSequence,
  deleteVocalzoidNote,
  insertVocalzoidNote,
  normalizeVocalzoidWord,
  replaceVocalzoidNotePhone,
  splitVocalzoidNote,
  updateVocalzoidNote,
  vocalzoidMidiFrequency,
  vocalzoidMidiName,
  vocalzoidPronunciation,
  vocalzoidRenderPlan,
  vocalzoidSequenceBeats,
} from "./vocalzoid.js";
import { VocalzoidAudio } from "./vocalzoid-audio.js";
import {
  SPELLING_PRONUNCIATION_PHONE_CATALOG,
  loadSpellingPronunciations,
  spellingPronunciationTokens,
} from "../spelling-synthesizer/spelling-pronunciation.js";

const $ = (id) => document.getElementById(id);
const ROW_HEIGHT = 20;
const ROW_COUNT = VOCALZOID_MAX_MIDI - VOCALZOID_MIN_MIDI + 1;
const PHONE_CATALOG_BY_ID = new Map(
  SPELLING_PRONUNCIATION_PHONE_CATALOG.map((phone) => [phone.id, phone]),
);
const PHONE_MENU_GROUPS = Object.freeze([
  Object.freeze(["vowel", "Vowels"]),
  Object.freeze(["gliding-vowel", "Diphthongs + R-colored vowels"]),
  Object.freeze(["consonant", "Consonants"]),
]);

const DEFAULTS = Object.freeze({
  word: VOCALZOID_DEFAULT_WORD,
  level: 0.52,
  style: "raw",
  melody: "lift",
  bpm: 108,
  vibrato: 22,
  glide: 65,
  loop: false,
  scoreBeats: 8,
  randomScore: false,
});

const state = {
  ...DEFAULTS,
  notes: createVocalzoidSequence(VOCALZOID_DEFAULT_WORD),
  selectedId: "vz-1",
  audioOn: false,
  starting: false,
  audioTransition: "",
  playing: false,
  playResult: null,
  playRequest: 0,
  scoreRequest: 0,
};

const audio = new VocalzoidAudio({
  level: state.level,
  style: state.style,
});

let animationFrame = 0;
let canvasWidth = 0;
let canvasHeight = 0;
let spectrumBins = new Uint8Array(512);
let drag = null;
let noteSerial = 0;

function setPressed(element, pressed) {
  element?.setAttribute("aria-pressed", String(Boolean(pressed)));
}

function announce(message) {
  $("liveStatus").textContent = message;
}

function showError(message) {
  $("audioError").textContent = message;
  $("audioError").hidden = false;
}

function clearError() {
  $("audioError").textContent = "";
  $("audioError").hidden = true;
}

function selectedNote() {
  return state.notes.find((note) => note.id === state.selectedId) ?? state.notes[0] ?? null;
}

function sortNotesChronologically() {
  state.notes = [...state.notes].sort((left, right) => left.start - right.start);
}

function nextNoteId() {
  let id;
  do {
    noteSerial += 1;
    id = `vz-edit-${noteSerial}`;
  } while (state.notes.some((note) => note.id === id));
  return id;
}

function replaceNote(noteId, changes, { render = true } = {}) {
  state.notes = state.notes.map((note) => (
    note.id === noteId ? updateVocalzoidNote(note, changes) : note
  ));
  if (render) renderScore();
  else {
    renderSelectedNote();
  }
}

function commitNoteChange(noteId, changes, message) {
  const current = state.notes.find((note) => note.id === noteId);
  if (!current) return false;
  const edited = updateVocalzoidNote(current, changes);
  const changed = ["lyric", "alias", "start", "duration", "midi"].some(
    (key) => current[key] !== edited[key],
  ) || current.phones.length !== edited.phones.length
    || current.phones.some((phone, index) => phone !== edited.phones[index]);
  if (!changed) return false;
  haltPlayback();
  state.notes = state.notes.map((note) => (
    note.id === noteId ? edited : note
  ));
  sortNotesChronologically();
  state.selectedId = noteId;
  renderScore();
  selectNote(noteId, { focus: true });
  announce(message);
  return true;
}

function sequenceBeats() {
  const contentBeats = state.notes.length ? vocalzoidSequenceBeats(state.notes) : 0;
  state.scoreBeats = Math.max(4, state.scoreBeats, Math.ceil(contentBeats + 1));
  return state.scoreBeats;
}

function addNote({ start, midi } = {}) {
  const template = selectedNote();
  const id = nextNoteId();
  const noteStart = clampVocalzoid(
    start ?? (template ? template.start + template.duration : 0),
    0,
    62,
  );
  const note = {
    id,
    lyric: template?.lyric ?? "ah",
    phones: [...(template?.phones ?? ["AH"])],
    alias: template?.alias ?? "",
    start: Math.round(noteStart * 4) / 4,
    duration: 1,
    midi: Math.round(clampVocalzoid(midi ?? template?.midi ?? 60, VOCALZOID_MIN_MIDI, VOCALZOID_MAX_MIDI)),
  };
  haltPlayback();
  state.notes = insertVocalzoidNote(state.notes, note);
  state.selectedId = id;
  state.scoreBeats = Math.max(state.scoreBeats, Math.ceil(note.start + note.duration + 1));
  renderScore();
  selectNote(id, { focus: true });
  announce(`Added ${note.lyric} at beat ${Number(note.start.toFixed(2)) + 1}.`);
}

function deleteNote(noteId = state.selectedId) {
  const index = state.notes.findIndex((note) => note.id === noteId);
  if (index < 0) return false;
  const removed = state.notes[index];
  haltPlayback();
  state.notes = deleteVocalzoidNote(state.notes, noteId);
  const next = state.notes[Math.min(index, state.notes.length - 1)] ?? null;
  state.selectedId = next?.id ?? "";
  renderScore();
  if (next) selectNote(next.id, { focus: true });
  announce(`Deleted ${removed.lyric}. ${state.notes.length} note${state.notes.length === 1 ? "" : "s"} remain.`);
  return true;
}

function splitNote(noteId = state.selectedId, splitBeat = null) {
  const note = state.notes.find((entry) => entry.id === noteId);
  if (!note) return false;
  const cutAt = Math.round((splitBeat ?? note.start + note.duration / 2) * 4) / 4;
  const id = nextNoteId();
  const split = splitVocalzoidNote(state.notes, noteId, cutAt, id);
  if (split.length !== state.notes.length + 1) {
    announce("Move the cut at least a quarter beat away from either note edge.");
    return false;
  }
  haltPlayback();
  state.notes = split;
  state.selectedId = id;
  renderScore();
  selectNote(id, { focus: true });
  announce(`Cut ${note.lyric} at beat ${Number(cutAt.toFixed(2)) + 1}.`);
  return true;
}

function phoneText(phones) {
  return [...(phones ?? [])].join(" · ");
}

function phoneJoinText(phones) {
  return [...(phones ?? [])].join("→");
}

function updateAudioUi() {
  setPressed($("audioButton"), state.audioOn);
  const busy = Boolean(state.audioTransition) || state.starting;
  $("audioButton").disabled = busy;
  $("audioState").textContent = state.audioTransition
    || (state.starting
      ? "loading"
      : state.audioOn ? (state.playing ? "singing" : "ready") : "off");
  setPressed($("playButton"), state.playing);
  $("playButton").disabled = busy;
  $("playButton").querySelector("span").textContent = state.starting
    ? "Loading voice"
    : state.playing ? "Singing" : "Sing word";
  document.body.classList.toggle("is-playing", state.playing);
  document.body.classList.toggle("has-vocalzoid-audio", state.audioOn);
}

function updateControlUi() {
  $("wordInput").value = state.word;
  $("level").value = String(state.level);
  $("levelOut").textContent = `${Math.round(state.level / 0.86 * 100)}%`;
  $("bpm").value = String(state.bpm);
  $("bpmOut").textContent = `${Math.round(state.bpm)} BPM`;
  $("vibrato").value = String(state.vibrato);
  $("vibratoOut").textContent = `${Math.round(state.vibrato)} ct`;
  $("glide").value = String(state.glide);
  $("glideOut").textContent = `${Math.round(state.glide)} ms`;
  $("loopButton").setAttribute("aria-checked", String(state.loop));
  for (const button of $("melodyPresets").querySelectorAll("[data-melody]")) {
    setPressed(button, button.dataset.melody === state.melody);
  }
  const style = VOCALZOID_STYLES[state.style];
  for (const button of $("styleButtons").querySelectorAll("[data-style]")) {
    setPressed(button, button.dataset.style === state.style);
  }
  $("styleDescription").textContent = style.description;
  document.body.style.setProperty("--vz-accent", style.color);
  const rgb = style.color.match(/[a-f\d]{2}/gi)?.map((pair) => Number.parseInt(pair, 16));
  if (rgb?.length === 3) document.body.style.setProperty("--vz-accent-rgb", rgb.join(", "));
}

function updateSourceUi() {
  $("sourceBadge").textContent = "KAL16";
}

function renderPitchLabels() {
  const fragment = document.createDocumentFragment();
  for (let midi = VOCALZOID_MAX_MIDI; midi >= VOCALZOID_MIN_MIDI; midi -= 1) {
    const label = document.createElement("span");
    const name = vocalzoidMidiName(midi);
    label.className = `pitch-label${name.includes("♯") ? " is-black" : ""}${name.startsWith("C") && !name.includes("♯") ? " is-c" : ""}`;
    label.textContent = name;
    fragment.append(label);
  }
  $("pitchLabels").replaceChildren(fragment);
}

function renderBeatRuler(totalBeats) {
  const fragment = document.createDocumentFragment();
  for (let beat = 0; beat < totalBeats; beat += 1) {
    const marker = document.createElement("span");
    const label = document.createElement("b");
    label.textContent = String(beat + 1).padStart(2, "0");
    marker.append(label);
    fragment.append(marker);
  }
  $("beatRuler").replaceChildren(fragment);
}

function notePosition(note, totalBeats) {
  return {
    left: `${note.start / totalBeats * 100}%`,
    width: `${note.duration / totalBeats * 100}%`,
    top: `${(VOCALZOID_MAX_MIDI - note.midi) * ROW_HEIGHT + 2}px`,
  };
}

function pianoGridPoint(clientX, clientY) {
  const rect = $("pianoGrid").getBoundingClientRect();
  const x = clampVocalzoid((clientX - rect.left) / Math.max(1, rect.width), 0, 1);
  const row = Math.floor(clampVocalzoid(
    (clientY - rect.top) / ROW_HEIGHT,
    0,
    ROW_COUNT - 0.001,
  ));
  return Object.freeze({
    beat: Math.round(x * sequenceBeats() * 4) / 4,
    midi: VOCALZOID_MAX_MIDI - row,
  });
}

function selectNote(noteId, { focus = false } = {}) {
  state.selectedId = noteId;
  for (const node of $("noteLayer").querySelectorAll(".vocal-note")) {
    node.classList.toggle("is-selected", node.dataset.noteId === noteId);
    node.setAttribute("aria-pressed", String(node.dataset.noteId === noteId));
  }
  renderSelectedNote();
  if (focus) $("noteLayer").querySelector(`[data-note-id="${CSS.escape(noteId)}"]`)?.focus();
}

function startNoteDrag(event, noteId) {
  if (event.button !== 0) return;
  const note = state.notes.find((entry) => entry.id === noteId);
  if (!note) return;
  event.preventDefault();
  event.currentTarget.setPointerCapture?.(event.pointerId);
  selectNote(noteId);
  drag = {
    kind: event.target?.closest?.(".note-resize-handle") ? "resize" : "move",
    noteId,
    pointerId: event.pointerId,
    clientX: event.clientX,
    clientY: event.clientY,
    start: note.start,
    duration: note.duration,
    midi: note.midi,
    totalBeats: sequenceBeats(),
    changed: false,
  };
}

function renderNotes(totalBeats) {
  const fragment = document.createDocumentFragment();
  state.notes.forEach((note, index) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `vocal-note${note.id === state.selectedId ? " is-selected" : ""}${note.duration <= 0.5 ? " is-compact" : ""}`;
    button.dataset.noteId = note.id;
    button.setAttribute("aria-pressed", String(note.id === state.selectedId));
    button.setAttribute(
      "aria-label",
      `${note.lyric}, phones ${note.phones.join(", ")}, ${vocalzoidMidiName(note.midi)}, starts at beat ${Number(note.start.toFixed(2)) + 1}, ${note.duration} beats. Drag to move; drag the right edge to resize; press Delete to remove.`,
    );
    Object.assign(button.style, notePosition(note, totalBeats));
    const noteLabel = document.createElement("span");
    const lyric = document.createElement("b");
    lyric.textContent = note.lyric;
    const pronunciation = document.createElement("i");
    pronunciation.textContent = phoneJoinText(note.phones);
    noteLabel.append(lyric, pronunciation);
    const pitch = document.createElement("small");
    pitch.className = "note-pitch";
    pitch.textContent = vocalzoidMidiName(note.midi);
    const resizeHandle = document.createElement("span");
    resizeHandle.className = "note-resize-handle";
    resizeHandle.setAttribute("aria-hidden", "true");
    button.append(noteLabel, pitch, resizeHandle);
    button.addEventListener("pointerdown", (event) => startNoteDrag(event, note.id));
    button.addEventListener("click", () => selectNote(note.id));
    button.addEventListener("dblclick", (event) => {
      event.preventDefault();
      event.stopPropagation();
      splitNote(note.id, pianoGridPoint(event.clientX, event.clientY).beat);
    });
    button.addEventListener("keydown", (event) => {
      if (event.key === "Delete" || event.key === "Backspace") {
        event.preventDefault();
        deleteNote(note.id);
        return;
      }
      const vertical = event.key === "ArrowUp" ? 1 : event.key === "ArrowDown" ? -1 : 0;
      const horizontal = event.key === "ArrowRight" ? 0.25 : event.key === "ArrowLeft" ? -0.25 : 0;
      if (!vertical && !horizontal) return;
      event.preventDefault();
      if (event.shiftKey && horizontal) {
        commitNoteChange(
          note.id,
          { duration: note.duration + horizontal },
          `${note.lyric} resized to ${Number(clampVocalzoid(note.duration + horizontal, 0.25, 16).toFixed(2))} beats.`,
        );
      } else {
        const nextStart = clampVocalzoid(note.start + horizontal, 0, 62);
        const nextMidi = Math.round(clampVocalzoid(
          note.midi + vertical,
          VOCALZOID_MIN_MIDI,
          VOCALZOID_MAX_MIDI,
        ));
        commitNoteChange(
          note.id,
          { midi: nextMidi, start: nextStart },
          `${note.lyric} moved to beat ${Number(nextStart.toFixed(2)) + 1}, ${vocalzoidMidiName(nextMidi)}.`,
        );
      }
    });
    fragment.append(button);
  });
  $("noteLayer").replaceChildren(fragment);
}

function renderPitchCurve() {
  const svg = $("pitchCurve");
  const width = 1_000;
  const height = ROW_COUNT * ROW_HEIGHT;
  const totalBeats = sequenceBeats();
  svg.setAttribute("viewBox", `0 0 ${width} ${height}`);
  const points = state.notes
    .slice()
    .sort((left, right) => left.start - right.start)
    .map((note) => ({
      x: (note.start + note.duration * 0.5) / totalBeats * width,
      y: (VOCALZOID_MAX_MIDI - note.midi + 0.5) * ROW_HEIGHT,
    }));
  const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
  path.setAttribute("d", points.map((point, index) => `${index ? "L" : "M"}${point.x} ${point.y}`).join(" "));
  const nodes = points.map((point) => {
    const circle = document.createElementNS("http://www.w3.org/2000/svg", "circle");
    circle.setAttribute("cx", String(point.x));
    circle.setAttribute("cy", String(point.y));
    circle.setAttribute("r", "2.4");
    return circle;
  });
  svg.replaceChildren(path, ...nodes);
}

function renderPhonemeRibbon() {
  const lane = document.createElement("div");
  lane.className = "phoneme-lane";
  lane.style.setProperty("--beat-count", String(sequenceBeats()));
  const beatSeconds = 60 / state.bpm;
  const totalSeconds = sequenceBeats() * beatSeconds;
  const plan = vocalzoidRenderPlan(state.notes, state.bpm);
  for (const event of plan) {
    const visibleStart = Math.max(0, event.start);
    const visibleEnd = Math.min(totalSeconds, event.start + event.duration);
    if (visibleEnd <= visibleStart) continue;
    const cell = document.createElement("span");
    cell.className = `phoneme-cell${event.sustain ? " is-vowel" : ""} is-${event.role}`;
    cell.dataset.noteId = event.noteId;
    cell.style.left = `${visibleStart / totalSeconds * 100}%`;
    cell.style.width = `${(visibleEnd - visibleStart) / totalSeconds * 100}%`;
    cell.title = `${event.phone} · ${event.role} · ${event.duration.toFixed(3)} s`;
    cell.textContent = event.phone;
    lane.append(cell);
  }
  $("phonemeRibbon").replaceChildren(lane);
}

function phoneSlotRole(note, index) {
  const definition = PHONE_CATALOG_BY_ID.get(note.phones[index]);
  if (definition?.vowel) return "vowel nucleus";
  const nucleus = note.phones.findIndex((phone) => PHONE_CATALOG_BY_ID.get(phone)?.vowel);
  if (nucleus < 0) return "consonant";
  return index < nucleus ? "onset" : "coda";
}

function renderNotePhoneMenus(note) {
  const container = $("notePhoneMenus");
  if (!note) {
    const empty = document.createElement("span");
    empty.className = "note-phone-empty";
    empty.textContent = "Add or select a note to edit its pronunciation.";
    container.replaceChildren(empty);
    return;
  }

  const fragment = document.createDocumentFragment();
  note.phones.forEach((phoneId, index) => {
    const definition = PHONE_CATALOG_BY_ID.get(phoneId);
    const vowelSlot = Boolean(definition?.vowel);
    const role = phoneSlotRole(note, index);
    const picker = document.createElement("div");
    picker.className = `note-phone-picker is-${vowelSlot ? "vowel" : "consonant"}`;
    const position = document.createElement("span");
    position.textContent = `${String(index + 1).padStart(2, "0")} · ${role}`;
    const select = document.createElement("select");
    select.dataset.phoneIndex = String(index);
    select.setAttribute(
      "aria-label",
      `Sound ${index + 1} of ${note.phones.length} for ${note.lyric}, ${role}`,
    );
    select.setAttribute("aria-describedby", "phoneMenuHelp");
    for (const [groupId, label] of PHONE_MENU_GROUPS) {
      if (vowelSlot ? groupId === "consonant" : groupId !== "consonant") continue;
      const group = document.createElement("optgroup");
      group.label = label;
      for (const phone of SPELLING_PRONUNCIATION_PHONE_CATALOG) {
        if (phone.group !== groupId) continue;
        const option = document.createElement("option");
        option.value = phone.id;
        option.textContent = phone.label;
        group.append(option);
      }
      select.append(group);
    }
    select.value = phoneId;
    select.addEventListener("change", (event) => {
      changeNotePhone(note.id, index, event.currentTarget.value);
    });
    picker.append(position, select);
    fragment.append(picker);
  });
  container.replaceChildren(fragment);
}

function changeNotePhone(noteId, phoneIndex, replacementId) {
  const current = state.notes.find((note) => note.id === noteId);
  if (!current) return false;
  const edited = replaceVocalzoidNotePhone(current, phoneIndex, replacementId);
  if (edited === current) return false;
  const previousPhone = current.phones[phoneIndex];
  const replacement = PHONE_CATALOG_BY_ID.get(edited.phones[phoneIndex]);
  haltPlayback();
  state.notes = state.notes.map((note) => note.id === noteId ? edited : note);
  state.selectedId = noteId;
  renderScore();
  $("notePhoneMenus").querySelector(`[data-phone-index="${phoneIndex}"]`)?.focus();
  announce(
    `${current.lyric}: ${previousPhone} changed to ${replacement.id}, /${replacement.ipa}/ as in ${replacement.example}. `
      + `The ${phoneText(edited.phones)} diphone sequence is ready.`,
  );
  return true;
}

function renderSelectedNote() {
  const note = selectedNote();
  const hasNote = Boolean(note);
  $("notePitch").disabled = !hasNote;
  $("noteDuration").disabled = !hasNote;
  $("phoneEditor").setAttribute("aria-disabled", String(!hasNote));
  renderNotePhoneMenus(note);
  $("splitNoteButton").disabled = !note || note.duration < 0.5;
  $("deleteNoteButton").disabled = !hasNote;
  if (!note) {
    state.selectedId = "";
    $("selectedLyric").textContent = "No note";
    $("selectedPhones").textContent = "double-click the grid or choose + Note";
    $("selectedNoteNumber").textContent = "00 / 00";
    $("notePitchOut").textContent = "—";
    $("noteDurationOut").textContent = "—";
    return;
  }
  if (state.selectedId !== note.id) state.selectedId = note.id;
  const index = state.notes.findIndex((entry) => entry.id === note.id);
  $("selectedLyric").textContent = note.lyric;
  $("selectedPhones").textContent = phoneText(note.phones);
  $("selectedNoteNumber").textContent = `${String(index + 1).padStart(2, "0")} / ${String(state.notes.length).padStart(2, "0")}`;
  $("notePitch").value = String(note.midi);
  $("notePitchOut").textContent = `${vocalzoidMidiName(note.midi)} · ${Math.round(vocalzoidMidiFrequency(note.midi))} Hz`;
  $("noteDuration").value = String(note.duration);
  $("noteDurationOut").textContent = `${Number(note.duration.toFixed(2))} beat${note.duration === 1 ? "" : "s"}`;
}

function renderScore() {
  const totalBeats = sequenceBeats();
  $("pianoGrid").style.setProperty("--beat-count", String(totalBeats));
  renderBeatRuler(totalBeats);
  renderNotes(totalBeats);
  renderPitchCurve();
  renderPhonemeRibbon();
  renderSelectedNote();
  $("phoneReadout").textContent = state.notes.length
    ? state.notes.map((note) => phoneText(note.phones)).join(" / ")
    : "No notes · double-click the grid to add one";
}

function updateCurrentEvent(progressSeconds) {
  const beatSeconds = 60 / state.bpm;
  const beat = progressSeconds / beatSeconds;
  let note = null;
  for (const entry of state.notes) {
    const active = beat >= entry.start && beat < entry.start + entry.duration;
    if (active && (!note || entry.start >= note.start)) note = entry;
  }
  const plan = vocalzoidRenderPlan(state.notes, state.bpm);
  let event = null;
  for (const entry of plan) {
    const active = progressSeconds >= entry.start && progressSeconds < entry.start + entry.duration;
    // Vowels deliberately remain underneath codas. Prefer the most recently
    // started active unit so the readout advances from nucleus to release.
    if (active && (!event || entry.start >= event.start)) event = entry;
  }
  const token = note?.lyric ?? (state.playing ? "join" : "ready");
  const phone = event?.phone ?? "—";
  if ($("currentToken").textContent !== token) $("currentToken").textContent = token;
  if ($("currentPhone").textContent !== phone) $("currentPhone").textContent = phone;
  for (const node of $("noteLayer").querySelectorAll(".vocal-note")) {
    node.classList.toggle("is-active", node.dataset.noteId === note?.id);
  }
}

function resizeSpectrum() {
  const canvas = $("spectrumCanvas");
  const rect = canvas.getBoundingClientRect();
  const scale = Math.min(2, globalThis.devicePixelRatio || 1);
  const width = Math.max(1, Math.round(rect.width * scale));
  const height = Math.max(1, Math.round(rect.height * scale));
  if (canvas.width !== width || canvas.height !== height) {
    canvas.width = width;
    canvas.height = height;
  }
  canvasWidth = width;
  canvasHeight = height;
}

function drawSpectrum() {
  const canvas = $("spectrumCanvas");
  const context = canvas.getContext("2d");
  if (!context || !canvasWidth || !canvasHeight) return;
  context.clearRect(0, 0, canvasWidth, canvasHeight);
  if (audio.analyser && spectrumBins.length !== audio.analyser.frequencyBinCount) {
    spectrumBins = new Uint8Array(audio.analyser.frequencyBinCount);
  }
  spectrumBins.fill(0);
  audio.spectrum(spectrumBins);
  const bins = Math.min(100, spectrumBins.length);
  const barWidth = canvasWidth / bins;
  for (let index = 0; index < bins; index += 1) {
    const sourceIndex = Math.floor((index / bins) ** 1.55 * spectrumBins.length * 0.58);
    const amount = spectrumBins[sourceIndex] / 255;
    const height = Math.max(1, amount * canvasHeight * 0.92);
    context.fillStyle = index % 9 === 0
      ? "rgba(255, 118, 95, .62)"
      : VOCALZOID_STYLES[state.style].color;
    context.globalAlpha = 0.08 + amount * 0.58;
    context.fillRect(index * barWidth, canvasHeight - height, Math.max(1, barWidth - 1), height);
  }
  context.globalAlpha = 1;
}

function animationTick() {
  animationFrame = 0;
  drawSpectrum();
  if (state.playing && state.playResult && audio.context) {
    const progress = audio.context.currentTime - state.playResult.startedAt;
    const ratio = clampVocalzoid(progress / state.playResult.duration, 0, 1);
    $("rollPlayhead").style.left = `${ratio * 100}%`;
    updateCurrentEvent(Math.max(0, progress));
    if (progress >= state.playResult.duration + 0.04) {
      if (state.loop && state.audioOn) {
        state.playing = false;
        void playSequence();
      } else {
        finishPlayback();
      }
    }
  }
  if (state.playing) animationFrame = requestAnimationFrame(animationTick);
}

function ensureAnimation() {
  if (!animationFrame) animationFrame = requestAnimationFrame(animationTick);
}

function finishPlayback() {
  state.playing = false;
  state.playResult = null;
  $("rollPlayhead").style.left = "0%";
  updateCurrentEvent(-1);
  updateAudioUi();
}

function haltPlayback(message = "") {
  state.playRequest += 1;
  state.starting = false;
  audio.stop();
  finishPlayback();
  if (message) announce(message);
}

async function playSequence() {
  if (!state.audioOn || state.starting || state.audioTransition || !state.notes.length) {
    if (!state.audioOn) {
      const message = "Turn on Audio before singing the word.";
      showError(message);
      announce(message);
    } else if (!state.notes.length) {
      announce("Add a note before singing the score.");
    }
    return;
  }
  const request = ++state.playRequest;
  state.starting = true;
  updateAudioUi();
  clearError();
  try {
    const result = await audio.play(state.notes, {
      bpm: state.bpm,
      vibratoCents: state.vibrato,
      glideMs: state.glide,
    });
    if (request !== state.playRequest || !result) return;
    state.playResult = result;
    state.playing = true;
    const scoreName = state.randomScore ? "the randomized score" : state.word;
    announce(`${result.sourceName} is singing ${scoreName}.`);
    ensureAnimation();
  } catch (error) {
    if (request === state.playRequest) showError(error instanceof Error ? error.message : String(error));
  } finally {
    if (request === state.playRequest) {
      state.starting = false;
      updateAudioUi();
    }
  }
}

async function toggleAudio() {
  if (state.starting || state.audioTransition) return;
  clearError();
  if (state.audioOn) {
    state.playRequest += 1;
    state.audioTransition = "stopping";
    updateAudioUi();
    try {
      await audio.disable();
      state.audioOn = false;
      finishPlayback();
      announce("Vocalzoid audio off.");
    } catch (error) {
      showError(error instanceof Error ? error.message : String(error));
    } finally {
      state.audioTransition = "";
      updateAudioUi();
    }
    return;
  }
  state.audioTransition = "starting";
  updateAudioUi();
  try {
    await audio.enable();
    state.audioOn = true;
    announce("Vocalzoid audio ready.");
    ensureAnimation();
  } catch (error) {
    state.audioOn = false;
    showError(error instanceof Error ? error.message : String(error));
  } finally {
    state.audioTransition = "";
    updateAudioUi();
  }
}

async function pronunciationFor(word) {
  if (word.toLowerCase() === VOCALZOID_DEFAULT_WORD) return vocalzoidPronunciation(word);
  try {
    const dictionary = await loadSpellingPronunciations(word);
    const token = spellingPronunciationTokens(word, dictionary).find((entry) => entry.type === "word");
    if (token?.phones?.length) return token.phones.map((phone) => phone.id);
  } catch {}
  return vocalzoidPronunciation(word);
}

function randomizeScore() {
  state.scoreRequest += 1;
  haltPlayback();
  const randomized = createRandomVocalzoidScore();
  Object.assign(state, {
    notes: randomized.notes,
    selectedId: randomized.notes[0]?.id ?? "",
    style: randomized.style,
    bpm: randomized.bpm,
    vibrato: randomized.vibrato,
    glide: randomized.glide,
    scoreBeats: randomized.scoreBeats,
    randomScore: true,
  });
  audio.setStyle(state.style);
  $("buildScore").disabled = false;
  $("buildScore").textContent = "Set lyric";
  updateControlUi();
  updateSourceUi();
  renderScore();
  announce(
    `Randomized ${state.notes.length} notes at ${state.bpm} BPM, ${state.vibrato} cent vibrato, `
      + `${state.glide} millisecond glide, and ${VOCALZOID_STYLES[state.style].name}.`,
  );
}

async function buildScore() {
  const request = ++state.scoreRequest;
  const word = normalizeVocalzoidWord($("wordInput").value) || VOCALZOID_DEFAULT_WORD;
  haltPlayback();
  $("buildScore").disabled = true;
  $("buildScore").textContent = "Listening…";
  try {
    const phones = await pronunciationFor(word);
    if (request !== state.scoreRequest) return;
    state.word = word;
    state.notes = createVocalzoidSequence(word, { phones, preset: state.melody });
    state.scoreBeats = Math.max(8, Math.ceil(vocalzoidSequenceBeats(state.notes) + 1));
    state.randomScore = false;
    state.selectedId = state.notes[0]?.id ?? "";
    renderScore();
    announce(`${word} became ${state.notes.length} melody notes.`);
  } finally {
    if (request === state.scoreRequest) {
      $("buildScore").disabled = false;
      $("buildScore").textContent = "Set lyric";
    }
  }
}

function chooseKalStyle(styleId) {
  haltPlayback();
  state.style = styleId in VOCALZOID_STYLES ? styleId : "raw";
  audio.setStyle(state.style);
  updateControlUi();
  updateSourceUi();
  announce(`${VOCALZOID_STYLES[state.style].name} selected.`);
}

function resetVocalzoid() {
  state.scoreRequest += 1;
  haltPlayback();
  Object.assign(state, DEFAULTS, {
    notes: createVocalzoidSequence(VOCALZOID_DEFAULT_WORD),
    selectedId: "vz-1",
  });
  audio.setStyle(state.style);
  audio.setLevel(state.level);
  $("buildScore").disabled = false;
  $("buildScore").textContent = "Set lyric";
  updateControlUi();
  updateSourceUi();
  renderScore();
  announce("Vocalzoid reset.");
}

function installEvents() {
  $("audioButton").addEventListener("click", () => void toggleAudio());
  $("playButton").addEventListener("click", () => {
    if (state.playing) haltPlayback("Playback stopped.");
    else void playSequence();
  });
  $("stopButton").addEventListener("click", () => haltPlayback("Playback stopped."));
  $("loopButton").addEventListener("click", () => {
    state.loop = !state.loop;
    $("loopButton").setAttribute("aria-checked", String(state.loop));
    announce(`Loop ${state.loop ? "on" : "off"}.`);
  });
  $("buildScore").addEventListener("click", () => void buildScore());
  $("wordInput").addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      void buildScore();
    }
  });
  $("level").addEventListener("input", (event) => {
    state.level = clampVocalzoid(event.target.value, 0, 0.86);
    audio.setLevel(state.level);
    updateControlUi();
  });
  $("bpm").addEventListener("input", (event) => {
    state.bpm = clampVocalzoid(event.target.value, 40, 220);
    $("bpmOut").textContent = `${Math.round(state.bpm)} BPM`;
    renderPhonemeRibbon();
    if (state.playing) haltPlayback("Tempo changed. Play the word again.");
  });
  $("vibrato").addEventListener("input", (event) => {
    state.vibrato = clampVocalzoid(event.target.value, 0, 80);
    $("vibratoOut").textContent = `${Math.round(state.vibrato)} ct`;
  });
  $("glide").addEventListener("input", (event) => {
    state.glide = clampVocalzoid(event.target.value, 0, 240);
    $("glideOut").textContent = `${Math.round(state.glide)} ms`;
  });
  for (const button of $("styleButtons").querySelectorAll("[data-style]")) {
    button.addEventListener("click", () => chooseKalStyle(button.dataset.style));
  }
  for (const button of $("melodyPresets").querySelectorAll("[data-melody]")) {
    button.addEventListener("click", () => {
      haltPlayback();
      state.melody = button.dataset.melody in VOCALZOID_MELODY_PRESETS
        ? button.dataset.melody : "lift";
      state.notes = applyVocalzoidMelody(state.notes, state.melody);
      updateControlUi();
      renderScore();
    });
  }
  $("addNoteButton").addEventListener("click", () => addNote());
  $("randomizeButton").addEventListener("click", randomizeScore);
  $("splitNoteButton").addEventListener("click", () => splitNote());
  $("deleteNoteButton").addEventListener("click", () => deleteNote());
  $("pianoGrid").addEventListener("dblclick", (event) => {
    if (event.target?.closest?.(".vocal-note")) return;
    const point = pianoGridPoint(event.clientX, event.clientY);
    addNote({
      start: Math.min(point.beat, sequenceBeats() - 0.25),
      midi: point.midi,
    });
  });
  $("notePitch").addEventListener("input", (event) => {
    haltPlayback();
    replaceNote(state.selectedId, { midi: event.target.value });
  });
  $("noteDuration").addEventListener("input", (event) => {
    haltPlayback();
    replaceNote(state.selectedId, { duration: event.target.value });
  });
  $("resetButton").addEventListener("click", resetVocalzoid);

  document.addEventListener("pointermove", (event) => {
    if (!drag || event.pointerId !== drag.pointerId) return;
    event.preventDefault();
    const grid = $("pianoGrid");
    const rect = grid.getBoundingClientRect();
    const deltaBeats = Math.round((event.clientX - drag.clientX) / Math.max(1, rect.width) * drag.totalBeats * 4) / 4;
    const note = state.notes.find((entry) => entry.id === drag.noteId);
    if (!note) return;
    const changes = drag.kind === "resize"
      ? {
          duration: clampVocalzoid(
            drag.duration + deltaBeats,
            0.25,
            Math.min(16, Math.max(0.25, drag.totalBeats - drag.start)),
          ),
        }
      : {
          midi: Math.round(clampVocalzoid(
            drag.midi - Math.round((event.clientY - drag.clientY) / ROW_HEIGHT),
            VOCALZOID_MIN_MIDI,
            VOCALZOID_MAX_MIDI,
          )),
          start: clampVocalzoid(
            drag.start + deltaBeats,
            0,
            Math.max(0, drag.totalBeats - drag.duration),
          ),
        };
    const changed = Object.entries(changes).some(([key, value]) => note[key] !== value);
    if (!changed) return;
    if (!drag.changed) haltPlayback();
    drag.changed = true;
    replaceNote(drag.noteId, changes, { render: false });
    const edited = state.notes.find((entry) => entry.id === drag.noteId);
    const node = $("noteLayer").querySelector(`[data-note-id="${CSS.escape(drag.noteId)}"]`);
    if (node && edited) {
      Object.assign(node.style, notePosition(edited, drag.totalBeats));
      node.classList.toggle("is-resizing", drag.kind === "resize");
      node.classList.toggle("is-compact", edited.duration <= 0.5);
      node.querySelector(".note-pitch").textContent = vocalzoidMidiName(edited.midi);
    }
  });
  const endDrag = (event) => {
    if (!drag || (event.pointerId != null && event.pointerId !== drag.pointerId)) return;
    const completed = drag;
    drag = null;
    if (completed.changed) {
      sortNotesChronologically();
      const edited = state.notes.find((note) => note.id === completed.noteId);
      if (edited) {
        state.scoreBeats = Math.max(
          state.scoreBeats,
          Math.ceil(edited.start + edited.duration + 1),
        );
        announce(completed.kind === "resize"
          ? `${edited.lyric} resized to ${Number(edited.duration.toFixed(2))} beats.`
          : `${edited.lyric} moved to beat ${Number(edited.start.toFixed(2)) + 1}, ${vocalzoidMidiName(edited.midi)}.`);
      }
      renderScore();
    }
  };
  document.addEventListener("pointerup", endDrag);
  document.addEventListener("pointercancel", endDrag);
  globalThis.addEventListener("resize", resizeSpectrum, { passive: true });
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) haltPlayback();
  });
  globalThis.addEventListener("pagehide", () => { void audio.close(); }, { once: true });
}

renderPitchLabels();
resizeSpectrum();
installEvents();
updateControlUi();
updateSourceUi();
renderScore();
drawSpectrum();

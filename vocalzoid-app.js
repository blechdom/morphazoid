import {
  VOCALZOID_DEFAULT_WORD,
  VOCALZOID_MAX_MIDI,
  VOCALZOID_MELODY_PRESETS,
  VOCALZOID_MIN_MIDI,
  VOCALZOID_STYLES,
  applyVocalzoidMelody,
  clampVocalzoid,
  createVocalzoidSequence,
  normalizeVocalzoidWord,
  updateVocalzoidNote,
  vocalzoidBankCoverage,
  vocalzoidMidiFrequency,
  vocalzoidMidiName,
  vocalzoidPronunciation,
  vocalzoidRenderPlan,
  vocalzoidSequenceBeats,
} from "./src/vocalzoid.js";
import { VocalzoidAudio } from "./src/vocalzoid-audio.js";
import {
  loadUtauBankFiles,
  utauBankAliases,
} from "./src/vocalzoid-bank.js";
import {
  VOCALZOID_OPEN_BANKS,
  vocalzoidOpenBankCoverage,
} from "./src/vocalzoid-open-banks.js";
import {
  loadSpellingPronunciations,
  spellingPronunciationTokens,
} from "./src/spelling-pronunciation.js";

const $ = (id) => document.getElementById(id);
const ROW_HEIGHT = 20;
const ROW_COUNT = VOCALZOID_MAX_MIDI - VOCALZOID_MIN_MIDI + 1;

const DEFAULTS = Object.freeze({
  word: VOCALZOID_DEFAULT_WORD,
  level: 0.52,
  style: "raw",
  melody: "lift",
  bpm: 108,
  vibrato: 22,
  glide: 65,
  loop: false,
});

const state = {
  ...DEFAULTS,
  notes: createVocalzoidSequence(VOCALZOID_DEFAULT_WORD),
  selectedId: "vz-1",
  audioOn: false,
  starting: false,
  audioTransition: "",
  playing: false,
  source: "kal",
  openBankId: "",
  localBank: null,
  localRootMidi: 60,
  playResult: null,
  playRequest: 0,
  scoreRequest: 0,
  importRequest: 0,
  sourceRevision: 0,
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

function replaceNote(noteId, changes, { render = true } = {}) {
  state.notes = state.notes.map((note) => (
    note.id === noteId ? updateVocalzoidNote(note, changes) : note
  ));
  if (render) renderScore();
  else {
    renderSelectedNote();
    renderPitchCurve();
    updateBankCoverage();
  }
}

function sequenceBeats() {
  return Math.max(4, Math.ceil(vocalzoidSequenceBeats(state.notes)));
}

function phoneText(phones) {
  return [...(phones ?? [])].join(" · ");
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
    setPressed(button, button.dataset.style === state.style && state.source === "kal");
  }
  $("styleDescription").textContent = style.description;
  document.body.style.setProperty("--vz-accent", style.color);
  const rgb = style.color.match(/[a-f\d]{2}/gi)?.map((pair) => Number.parseInt(pair, 16));
  if (rgb?.length === 3) document.body.style.setProperty("--vz-accent-rgb", rgb.join(", "));
}

function updateSourceUi() {
  const open = VOCALZOID_OPEN_BANKS[state.openBankId];
  const sourceName = state.source === "local"
    ? state.localBank?.name || "local bank"
    : state.source === "open" ? open?.name || "CC0 bank" : "built in";
  $("sourceBadge").textContent = sourceName;
  for (const button of $("openBankButtons").querySelectorAll("[data-open-bank]")) {
    setPressed(button, state.source === "open" && button.dataset.openBank === state.openBankId);
  }
  $("useLocalBank").disabled = !state.localBank || state.source === "local";
  updateBankCoverage();
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
    noteId,
    pointerId: event.pointerId,
    clientX: event.clientX,
    clientY: event.clientY,
    start: note.start,
    midi: note.midi,
    totalBeats: sequenceBeats(),
    moved: false,
  };
}

function renderNotes(totalBeats) {
  const fragment = document.createDocumentFragment();
  state.notes.forEach((note, index) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `vocal-note${note.id === state.selectedId ? " is-selected" : ""}`;
    button.dataset.noteId = note.id;
    button.setAttribute("aria-pressed", String(note.id === state.selectedId));
    button.setAttribute(
      "aria-label",
      `${note.lyric}, ${vocalzoidMidiName(note.midi)}, ${note.duration} beats. Drag to change time and pitch.`,
    );
    Object.assign(button.style, notePosition(note, totalBeats));
    const lyric = document.createElement("span");
    lyric.textContent = note.lyric;
    const pitch = document.createElement("small");
    pitch.textContent = vocalzoidMidiName(note.midi);
    button.append(lyric, pitch);
    button.addEventListener("pointerdown", (event) => startNoteDrag(event, note.id));
    button.addEventListener("click", () => selectNote(note.id));
    button.addEventListener("keydown", (event) => {
      const vertical = event.key === "ArrowUp" ? 1 : event.key === "ArrowDown" ? -1 : 0;
      const horizontal = event.key === "ArrowRight" ? 0.25 : event.key === "ArrowLeft" ? -0.25 : 0;
      if (!vertical && !horizontal) return;
      event.preventDefault();
      haltPlayback();
      if (event.shiftKey && horizontal) {
        replaceNote(note.id, { duration: note.duration + horizontal });
      } else {
        replaceNote(note.id, { midi: note.midi + vertical, start: Math.max(0, note.start + horizontal) });
      }
      selectNote(note.id, { focus: true });
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
  const fragment = document.createDocumentFragment();
  for (const note of state.notes) {
    for (const phone of note.phones) {
      const cell = document.createElement("span");
      cell.className = `phoneme-cell${/[AEIOU]/.test(phone[0]) ? " is-vowel" : ""}`;
      cell.style.flexGrow = String(note.duration / Math.max(1, note.phones.length));
      cell.textContent = phone;
      fragment.append(cell);
    }
  }
  $("phonemeRibbon").replaceChildren(fragment);
}

function renderSelectedNote() {
  const note = selectedNote();
  if (!note) return;
  const index = state.notes.findIndex((entry) => entry.id === note.id);
  $("selectedLyric").textContent = note.lyric;
  $("selectedPhones").textContent = phoneText(note.phones);
  $("selectedNoteNumber").textContent = `${String(index + 1).padStart(2, "0")} / ${String(state.notes.length).padStart(2, "0")}`;
  $("notePitch").value = String(note.midi);
  $("notePitchOut").textContent = `${vocalzoidMidiName(note.midi)} · ${Math.round(vocalzoidMidiFrequency(note.midi))} Hz`;
  $("noteDuration").value = String(note.duration);
  $("noteDurationOut").textContent = `${Number(note.duration.toFixed(2))} beat${note.duration === 1 ? "" : "s"}`;
  $("aliasInput").value = note.alias;
}

function renderScore() {
  const totalBeats = sequenceBeats();
  $("pianoGrid").style.setProperty("--beat-count", String(totalBeats));
  renderBeatRuler(totalBeats);
  renderNotes(totalBeats);
  renderPitchCurve();
  renderPhonemeRibbon();
  renderSelectedNote();
  $("phoneReadout").textContent = state.notes.map((note) => phoneText(note.phones)).join(" / ");
  updateBankCoverage();
}

function updateBankCoverage() {
  if (!state.localBank) return;
  const coverage = vocalzoidBankCoverage(state.localBank.entries, state.notes);
  $("coverageFill").style.width = `${coverage.ratio * 100}%`;
  $("bankCoverage").textContent = `${coverage.matched} / ${coverage.total} score notes auto-matched · exact alias can override`;
}

function updateCurrentEvent(progressSeconds) {
  const beatSeconds = 60 / state.bpm;
  const beat = progressSeconds / beatSeconds;
  const note = state.notes.find((entry) => beat >= entry.start && beat < entry.start + entry.duration);
  const plan = vocalzoidRenderPlan(state.notes, state.bpm);
  const event = plan.find((entry) => progressSeconds >= entry.start && progressSeconds < entry.start + entry.duration);
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
    if (state.source === "open" && result.openNotes === 0) {
      $("bankStatus").textContent = `${VOCALZOID_OPEN_BANKS[state.openBankId]?.name ?? "The CC0 bank"} could not render this score; every note is using KAL16.`;
    } else if (state.source === "open" && result.fallbackNotes > 0) {
      $("bankStatus").textContent = `${result.openNotes} notes use ${result.sourceName}; ${result.fallbackNotes} use KAL16.`;
    }
    const fallback = result.fallbackNotes
      ? ` ${result.fallbackNotes} note${result.fallbackNotes === 1 ? "" : "s"} fell back to KAL16.`
      : "";
    announce(`${result.sourceName} is singing ${state.word}.${fallback}`);
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
  state.sourceRevision += 1;
  state.style = styleId in VOCALZOID_STYLES ? styleId : "raw";
  state.source = "kal";
  state.openBankId = "";
  audio.clearBank();
  audio.clearOpenBank();
  audio.setStyle(state.style);
  updateControlUi();
  updateSourceUi();
  announce(`${VOCALZOID_STYLES[state.style].name} selected.`);
}

function chooseOpenBank(bankId) {
  const bank = VOCALZOID_OPEN_BANKS[bankId];
  if (!bank) return;
  haltPlayback();
  state.sourceRevision += 1;
  state.source = "open";
  state.openBankId = bankId;
  audio.setOpenBank(bankId);
  updateControlUi();
  updateSourceUi();
  const coverage = vocalzoidOpenBankCoverage(state.notes);
  $("bankStatus").textContent = `${bank.name}: ${coverage.matched}/${coverage.total} notes use CC0 diphones; the rest use KAL16.`;
  announce(`${bank.name} selected.`);
}

function chooseLocalBank() {
  if (!state.localBank) return;
  haltPlayback();
  state.sourceRevision += 1;
  state.source = "local";
  state.openBankId = "";
  audio.setBank({ ...state.localBank, rootMidi: state.localRootMidi });
  audio.setStyle(state.style);
  updateControlUi();
  updateSourceUi();
  announce(`${state.localBank.name} selected. Unmatched notes use KAL16.`);
}

async function importBank(files) {
  const request = ++state.importRequest;
  const sourceRevision = state.sourceRevision;
  haltPlayback();
  clearError();
  $("bankDrop").classList.add("is-loading");
  $("bankStatus").textContent = "Reading local oto.ini files…";
  try {
    const bank = await loadUtauBankFiles(files);
    if (request !== state.importRequest) return;
    state.localBank = bank;
    state.localRootMidi = bank.rootMidi;
    $("loadedBank").hidden = false;
    $("bankName").textContent = bank.name;
    $("bankAuthor").textContent = bank.author;
    $("bankMeta").textContent = `${bank.stats.audioFiles.toLocaleString()} samples · ${bank.stats.entries.toLocaleString()} aliases · ${bank.stats.frqFiles.toLocaleString()} pitch maps`;
    $("bankRoot").value = String(Math.round(state.localRootMidi));
    $("bankRootOut").textContent = vocalzoidMidiName(state.localRootMidi);
    const aliasFragment = document.createDocumentFragment();
    for (const alias of utauBankAliases(bank).slice(0, 4_000)) {
      const option = document.createElement("option");
      option.value = alias;
      aliasFragment.append(option);
    }
    $("bankAliases").replaceChildren(aliasFragment);
    const canAutoSelect = sourceRevision === state.sourceRevision;
    if (canAutoSelect) chooseLocalBank();
    else updateSourceUi();
    const selectionStatus = canAutoSelect
      ? "It is selected."
      : "It is ready; your newer voice choice is unchanged.";
    $("bankStatus").textContent = `${bank.name} is in memory only. ${selectionStatus} ${bank.stats.missingEntries ? `${bank.stats.missingEntries} missing sample references were skipped.` : "All sample references resolved."}`;
  } catch (error) {
    if (request !== state.importRequest) return;
    $("bankStatus").textContent = "Voicebank import failed.";
    showError(error instanceof Error ? error.message : String(error));
  } finally {
    if (request === state.importRequest) {
      $("bankDrop").classList.remove("is-loading");
      $("bankInput").value = "";
    }
  }
}

function removeLocalBank() {
  state.importRequest += 1;
  haltPlayback();
  state.localBank = null;
  state.localRootMidi = 60;
  $("loadedBank").hidden = true;
  $("bankAliases").replaceChildren();
  $("bankStatus").textContent = "No local bank loaded.";
  chooseKalStyle(state.style);
}

function resetVocalzoid() {
  state.scoreRequest += 1;
  state.importRequest += 1;
  state.sourceRevision += 1;
  haltPlayback();
  Object.assign(state, DEFAULTS, {
    notes: createVocalzoidSequence(VOCALZOID_DEFAULT_WORD),
    selectedId: "vz-1",
    source: "kal",
    openBankId: "",
  });
  audio.clearBank();
  audio.clearOpenBank();
  audio.setStyle(state.style);
  audio.setLevel(state.level);
  $("buildScore").disabled = false;
  $("buildScore").textContent = "Set lyric";
  $("bankDrop").classList.remove("is-loading");
  $("bankInput").value = "";
  $("bankStatus").textContent = state.localBank
    ? `${state.localBank.name} remains loaded; choose Use to select it.`
    : "No local bank loaded.";
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
  for (const button of $("openBankButtons").querySelectorAll("[data-open-bank]")) {
    button.addEventListener("click", () => chooseOpenBank(button.dataset.openBank));
  }
  $("useKalButton").addEventListener("click", () => chooseKalStyle(state.style));
  $("useLocalBank").addEventListener("click", chooseLocalBank);
  $("notePitch").addEventListener("input", (event) => {
    haltPlayback();
    replaceNote(state.selectedId, { midi: event.target.value });
  });
  $("noteDuration").addEventListener("input", (event) => {
    haltPlayback();
    replaceNote(state.selectedId, { duration: event.target.value });
  });
  $("aliasInput").addEventListener("input", (event) => {
    replaceNote(state.selectedId, { alias: event.target.value }, { render: false });
  });
  $("bankInput").addEventListener("change", (event) => void importBank(event.target.files));
  $("bankDrop").addEventListener("dragover", (event) => {
    event.preventDefault();
    $("bankDrop").classList.add("is-dragging");
  });
  $("bankDrop").addEventListener("dragleave", () => $("bankDrop").classList.remove("is-dragging"));
  $("bankDrop").addEventListener("drop", (event) => {
    event.preventDefault();
    $("bankDrop").classList.remove("is-dragging");
    if (event.dataTransfer?.files?.length) void importBank(event.dataTransfer.files);
  });
  $("bankRoot").addEventListener("input", (event) => {
    const midi = Math.round(clampVocalzoid(event.target.value, 36, 84));
    state.localRootMidi = midi;
    if (audio.bank) audio.bank.rootMidi = midi;
    $("bankRootOut").textContent = vocalzoidMidiName(midi);
  });
  $("removeBank").addEventListener("click", removeLocalBank);
  $("resetButton").addEventListener("click", resetVocalzoid);

  document.addEventListener("pointermove", (event) => {
    if (!drag || event.pointerId !== drag.pointerId) return;
    const grid = $("pianoGrid");
    const rect = grid.getBoundingClientRect();
    const deltaMidi = -Math.round((event.clientY - drag.clientY) / ROW_HEIGHT);
    const deltaBeats = Math.round((event.clientX - drag.clientX) / Math.max(1, rect.width) * drag.totalBeats * 4) / 4;
    const note = state.notes.find((entry) => entry.id === drag.noteId);
    if (!note) return;
    drag.moved ||= Math.abs(event.clientX - drag.clientX) > 2 || Math.abs(event.clientY - drag.clientY) > 2;
    replaceNote(drag.noteId, {
      midi: drag.midi + deltaMidi,
      start: clampVocalzoid(drag.start + deltaBeats, 0, Math.max(0, drag.totalBeats - note.duration)),
    }, { render: false });
    const node = $("noteLayer").querySelector(`[data-note-id="${CSS.escape(drag.noteId)}"]`);
    if (node) {
      Object.assign(node.style, notePosition(selectedNote(), drag.totalBeats));
      node.querySelector("small").textContent = vocalzoidMidiName(selectedNote().midi);
    }
  });
  const endDrag = (event) => {
    if (!drag || (event.pointerId != null && event.pointerId !== drag.pointerId)) return;
    if (drag.moved) haltPlayback("Melody changed.");
    drag = null;
    renderScore();
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

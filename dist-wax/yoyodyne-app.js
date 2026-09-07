import { emitMidiOutputPreview } from "./src/midi-output-preview.js";
import {
  YOYODYNE_AUDIO_LIMITS,
  YoyodyneAudio,
  yoyodyneScoreGainScale,
} from "./src/yoyodyne-audio.js";
import {
  YOYODYNE_AUDIO_TIMING,
  YOYODYNE_LIMITS,
  clampYoyodyne,
  createYoyodynePhrase,
  formatYoyodynePitch,
  midiToFrequency,
  planYoyodyneAudioWindow,
  restoreYoyodyneNote,
  sanitizeYoyodyneNotes,
  updateYoyodyneNote,
  yoyodyneBeatWithinLoop,
  yoyodyneMaximumPolyphony,
  yoyodyneNotesAtBeat,
  yoyodyneScoreBeatAtAudioTime,
} from "./src/yoyodyne.js";

const $ = (id) => document.getElementById(id);
const canvas = $("noteStage");
const context = canvas.getContext("2d");
const audio = new YoyodyneAudio(globalThis);
const originals = createYoyodynePhrase();
const MAX_UNDO_STATES = 32;
const CANVAS_PIXEL_BUDGET = 2_600_000;
const MIDI_PREVIEW_ROUTE_ID = "yoyodyne";
const MIDI_PREVIEW_LOOKBACK_SECONDS = 0.14;
const PREVIEW_RETRIGGER_MILLISECONDS = 70;
const RELAY_ROLE_VISUALS = Object.freeze({
  throat: Object.freeze(["#35c9d8", "#526dc1", "#7650a9"]),
  mouth: Object.freeze(["#54dfc5", "#806fe0", "#c855b1"]),
  halo: Object.freeze(["#c8f06b", "#65d8ec", "#e86fc9"]),
});
const RELAY_ROLE_MARKS = Object.freeze({ throat: "T", mouth: "M", halo: "H" });

const state = {
  notes: createYoyodynePhrase(),
  selectedId: "sig-01",
  pitchSnap: "chromatic",
  timeSnap: "eighth",
  tempo: 96,
  character: 0.42,
  outputLevel: 0.34,
  audioOn: false,
  audioStarting: false,
  playing: false,
  frozen: false,
  scoreAnchorBeat: 0,
  performanceAnchorMs: performance.now(),
  audioAnchorTime: null,
  nextEventOrdinal: 0,
  schedulerId: 0,
  schedulerGeneration: 0,
  observedAudioContext: null,
  audioRecoveryPromise: null,
  frameId: 0,
  resizeObserver: null,
  resizeFallbackInstalled: false,
  undoStack: [],
  drag: null,
  controlBefore: null,
  hitRegions: [],
  geometry: null,
  cssWidth: 1,
  cssHeight: 1,
  dpr: 1,
  lastPreviewMs: -Infinity,
  editReconcileId: 0,
  midiPreviewBeat: null,
  lastFrameMs: -Infinity,
  needsDraw: true,
};

function selectedNote() {
  return state.notes.find((note) => note.id === state.selectedId) ?? state.notes[0] ?? null;
}

function cellNumber(note) {
  const match = String(note?.id ?? "").match(/(\d+)$/);
  return match ? Number(match[1]) : state.notes.indexOf(note) + 1;
}

function noteSignature(notes) {
  return JSON.stringify(notes.map((note) => [
    note.id,
    note.startBeat,
    note.durationBeats,
    note.pitch,
    note.voiceRole,
  ]));
}

function cloneNotes(notes) {
  return sanitizeYoyodyneNotes(notes);
}

function sameNotes(left, right) {
  return noteSignature(left) === noteSignature(right);
}

function announce(message) {
  $("liveStatus").textContent = "";
  requestAnimationFrame(() => {
    $("liveStatus").textContent = message;
  });
}

function showError(error) {
  const message = error instanceof Error ? error.message : String(error);
  $("audioError").textContent = message;
  $("audioError").hidden = false;
}

function clearError() {
  $("audioError").hidden = true;
  $("audioError").textContent = "";
}

function formatBeat(value) {
  return Number(value).toFixed(2);
}

function formatTransportBeat(scoreBeat) {
  const beat = yoyodyneBeatWithinLoop(scoreBeat);
  const bar = Math.floor(beat / YOYODYNE_LIMITS.beatsPerBar) + 1;
  const withinBar = beat % YOYODYNE_LIMITS.beatsPerBar + 1;
  return `BAR ${bar} · BEAT ${withinBar.toFixed(2)}`;
}

function characterName(value = state.character) {
  if (value < 0.34) return "open choir";
  if (value < 0.68) return "formant relay";
  return "charged chorus";
}

function setAudioUi() {
  const button = $("audioButton");
  const mode = state.audioStarting ? "starting" : state.audioOn ? "on" : "off";
  button.setAttribute("aria-pressed", String(state.audioOn));
  button.dataset.audioState = mode;
  button.disabled = state.audioStarting;
  $("audioState").textContent = mode;
}

function syncTransportDiagnostics() {
  canvas.dataset.schedulerState = state.schedulerId ? "running" : "stopped";
  canvas.dataset.clockSource = (
    state.audioOn
    && audio.running
    && Number.isFinite(state.audioAnchorTime)
  ) ? "audio-context" : "performance";
  canvas.dataset.nextEventOrdinal = String(state.nextEventOrdinal);
  canvas.dataset.schedulerGeneration = String(state.schedulerGeneration);
}

function syncSelectedUi() {
  const note = selectedNote();
  if (!note) return;
  const number = String(cellNumber(note)).padStart(2, "0");
  const pitchName = formatYoyodynePitch(note.pitch);
  const voiceRole = String(note.voiceRole ?? "mouth");
  $("selectedTitle").textContent = `CELL ${number}`;
  $("selectedSummary").textContent = `${voiceRole} voice · ${pitchName} · beat ${formatBeat(note.startBeat + 1)} · ${formatBeat(note.durationBeats)} beats`;
  $("selectedPitch").value = String(note.pitch);
  $("selectedPitch").step = state.pitchSnap === "chromatic" ? "1" : "0.01";
  $("selectedPitch").setAttribute("aria-valuetext", pitchName);
  $("selectedPitchOut").textContent = pitchName;
  $("selectedStart").value = String(note.startBeat);
  $("selectedStart").step = state.timeSnap === "eighth" ? "0.5" : "0.01";
  $("selectedStart").setAttribute("aria-valuetext", `beat ${formatBeat(note.startBeat + 1)}`);
  $("selectedStartOut").textContent = `beat ${formatBeat(note.startBeat + 1)}`;
  $("selectedDuration").max = String(Math.min(
    YOYODYNE_LIMITS.maximumDurationBeats,
    YOYODYNE_LIMITS.loopBeats - note.startBeat,
  ));
  $("selectedDuration").value = String(note.durationBeats);
  $("selectedDuration").step = state.timeSnap === "eighth" ? "0.5" : "0.01";
  $("selectedDuration").setAttribute("aria-valuetext", `${formatBeat(note.durationBeats)} beats`);
  $("selectedDurationOut").textContent = `${formatBeat(note.durationBeats)} beats`;
  $("stageCellOut").textContent = `${number} / ${state.notes.length}`;
  $("stagePitchOut").textContent = pitchName;
  $("stageTimeOut").textContent = formatBeat(note.startBeat + 1);
  $("cellSummary").textContent = `${voiceRole} · ${pitchName} · ${formatBeat(note.durationBeats)} beats`;
  canvas.dataset.selectedId = note.id;
  canvas.dataset.selectedRole = voiceRole;
  canvas.setAttribute(
    "aria-label",
    `Yoyodyne four-bar pitch and time editor. Selected ${voiceRole} cell ${number}, ${pitchName}, starts at beat ${formatBeat(note.startBeat + 1)}, duration ${formatBeat(note.durationBeats)} beats.`,
  );
  state.needsDraw = true;
}

function syncUi() {
  syncSelectedUi();
  setAudioUi();
  $("pitchSnap").value = state.pitchSnap;
  $("timeSnap").value = state.timeSnap;
  $("latticeSummary").textContent = `${state.pitchSnap === "chromatic" ? "chromatic" : "free cents"} · ${state.timeSnap === "eighth" ? "1/8 note" : "free time"}`;
  $("tempo").value = String(state.tempo);
  $("tempoOut").textContent = `${Math.round(state.tempo)} BPM`;
  $("character").value = String(state.character);
  $("characterOut").textContent = `${Math.round(state.character * 100)}%`;
  $("fieldSummary").textContent = `${Math.round(state.tempo)} BPM · ${characterName()}`;
  $("outputLevel").value = String(state.outputLevel);
  $("outputLevelOut").textContent = `${Math.round(state.outputLevel * 100)}%`;
  $("undoButton").disabled = state.undoStack.length === 0;
  $("playButton").setAttribute("aria-pressed", String(state.playing));
  $("playButton").setAttribute("aria-label", state.playing ? "Pause Yoyodyne loop" : "Play Yoyodyne loop");
  $("playGlyph").textContent = state.playing ? "Ⅱ" : "▶";
  $("playLabel").textContent = state.playing ? "Pause" : "Play";
  canvas.dataset.noteCount = String(state.notes.length);
  canvas.dataset.maxPolyphony = String(yoyodyneMaximumPolyphony(state.notes));
  canvas.dataset.audioArmed = String(state.audioOn);
  canvas.dataset.transport = state.playing ? "playing" : "stopped";
  syncTransportDiagnostics();
  state.needsDraw = true;
}

function performanceScoreBeat(now = performance.now()) {
  if (!state.playing || state.frozen) return state.scoreAnchorBeat;
  return Math.max(
    0,
    state.scoreAnchorBeat + (now - state.performanceAnchorMs) * state.tempo / 60_000,
  );
}

function visualAudioTime(now = performance.now()) {
  const audioContext = audio.context;
  const currentTime = Number(audioContext?.currentTime);
  if (!Number.isFinite(currentTime)) return 0;
  try {
    const timestamp = audioContext.getOutputTimestamp?.();
    const contextTime = Number(timestamp?.contextTime);
    const performanceTime = Number(timestamp?.performanceTime);
    const timestampAge = (now - performanceTime) / 1_000;
    if (
      Number.isFinite(contextTime)
      && contextTime >= 0
      && Number.isFinite(performanceTime)
      && performanceTime > 0
      && timestampAge >= -0.1
      && timestampAge <= 1
    ) {
      return Math.min(currentTime, Math.max(0, contextTime + timestampAge));
    }
  } catch {
    // Some hosts expose the timestamp method before an output device is ready.
  }
  const baseLatency = Math.max(0, Number(audioContext?.baseLatency) || 0);
  const outputLatency = Math.max(0, Number(audioContext?.outputLatency) || 0);
  return Math.max(0, currentTime - baseLatency - outputLatency);
}

function currentScoreBeat(now = performance.now()) {
  if (!state.playing || state.frozen) return state.scoreAnchorBeat;
  if (state.audioOn && audio.running && Number.isFinite(state.audioAnchorTime)) {
    return yoyodyneScoreBeatAtAudioTime({
      scoreAnchorBeat: state.scoreAnchorBeat,
      audioAnchorTime: state.audioAnchorTime,
      audioTime: Math.max(state.audioAnchorTime, visualAudioTime(now)),
      tempo: state.tempo,
    });
  }
  return performanceScoreBeat();
}

function midiPreviewDurationMs(note) {
  return Math.max(1, Math.round(note.durationBeats * 60_000 / state.tempo));
}

function publishMidiNotePreview(note, {
  source = "Yoyodyne signal onset",
  sourceId = "yoyodyne-sequence",
  voiceId = note.id,
  durationMs = midiPreviewDurationMs(note),
} = {}) {
  return emitMidiOutputPreview({
    kind: "note",
    routeId: MIDI_PREVIEW_ROUTE_ID,
    source,
    sourceId,
    voiceId,
    channel: 1,
    note: Math.round(note.pitch),
    frequencyHz: midiToFrequency(note.pitch),
    velocity: Math.max(1, Math.round(clampYoyodyne(note.energy, 0, 1, 0.7) * 127)),
    durationMs,
  });
}

function rebaseMidiPreview(score = currentScoreBeat(), { includeCurrent = false } = {}) {
  state.midiPreviewBeat = state.playing && !state.frozen
    ? Math.max(0, Number(score) || 0) - (includeCurrent ? 0.001 : 0)
    : null;
}

function publishMidiTransportOnsets(scoreBeat) {
  const current = Math.max(0, Number(scoreBeat) || 0);
  const previous = state.midiPreviewBeat;
  state.midiPreviewBeat = current;
  if (
    !state.playing
    || state.frozen
    || !Number.isFinite(previous)
    || current < previous
  ) return;

  const lookbackBeats = state.tempo / 60 * MIDI_PREVIEW_LOOKBACK_SECONDS;
  const lower = Math.max(previous, current - lookbackBeats);
  const firstCycle = Math.floor(lower / YOYODYNE_LIMITS.loopBeats);
  const lastCycle = Math.floor(current / YOYODYNE_LIMITS.loopBeats);
  let emitted = 0;
  for (let cycle = firstCycle; cycle <= lastCycle; cycle += 1) {
    for (const note of state.notes) {
      const onset = cycle * YOYODYNE_LIMITS.loopBeats + note.startBeat;
      if (onset <= lower + 1e-9 || onset > current + 1e-9) continue;
      publishMidiNotePreview(note);
      emitted += 1;
      if (emitted >= YOYODYNE_LIMITS.maximumNotes) return;
    }
  }
}

function stopAudioScheduler() {
  if (state.schedulerId) clearInterval(state.schedulerId);
  state.schedulerId = 0;
  syncTransportDiagnostics();
}

function detachAudioStateObserver() {
  state.observedAudioContext?.removeEventListener?.("statechange", handleObservedAudioState);
  state.observedAudioContext = null;
}

function observeAudioState() {
  const next = audio.context;
  if (next === state.observedAudioContext) return;
  detachAudioStateObserver();
  state.observedAudioContext = next;
  next?.addEventListener?.("statechange", handleObservedAudioState);
}

async function recoverObservedAudio(context) {
  if (state.audioRecoveryPromise) return state.audioRecoveryPromise;
  const generation = state.schedulerGeneration;
  const recovery = (async () => {
    if (
      context !== audio.context
      || !state.audioOn
      || state.audioStarting
      || state.frozen
      || document.hidden
    ) return;
    if (context.state === "suspended" || context.state === "interrupted") {
      await context.resume?.();
    }
    if (
      generation !== state.schedulerGeneration
      || context !== audio.context
      || !state.audioOn
      || state.frozen
      || document.hidden
    ) return;
    if (context.state !== "running") {
      throw new Error("Audio was interrupted and could not resume. Turn Audio on again.");
    }
    if (state.playing) reconcileScheduledAudio();
  })();
  state.audioRecoveryPromise = recovery;
  try {
    await recovery;
  } catch (error) {
    await handleAudioFailure(error, generation);
  } finally {
    if (state.audioRecoveryPromise === recovery) state.audioRecoveryPromise = null;
  }
}

function handleObservedAudioState() {
  const context = state.observedAudioContext;
  if (
    !context
    || context.state === "running"
    || !state.audioOn
    || state.audioStarting
    || state.frozen
    || document.hidden
  ) return;
  void recoverObservedAudio(context);
}

async function handleAudioFailure(error, generation = state.schedulerGeneration) {
  if (generation !== state.schedulerGeneration) return;
  const score = currentScoreBeat();
  state.schedulerGeneration += 1;
  state.audioOn = false;
  state.scoreAnchorBeat = score;
  state.performanceAnchorMs = performance.now();
  state.audioAnchorTime = null;
  stopAudioScheduler();
  audio.silence();
  showError(error);
  syncUi();
  if (state.playing) {
    $("transportNotice").textContent = "Audio is off — turn it on to hear playback";
  }
  detachAudioStateObserver();
  try {
    await audio.close();
  } catch {
    // The failed graph is already unavailable.
  }
}

function scheduleAudioWindow() {
  if (!state.playing || state.frozen || !state.audioOn || !audio.running) return;
  const generation = state.schedulerGeneration;
  const plan = planYoyodyneAudioWindow({
    notes: state.notes,
    nextEventOrdinal: state.nextEventOrdinal,
    tempo: state.tempo,
    scoreAnchorBeat: state.scoreAnchorBeat,
    audioAnchorTime: state.audioAnchorTime,
    nowAudioTime: audio.currentTime,
  });
  state.nextEventOrdinal = plan.nextEventOrdinal;
  syncTransportDiagnostics();
  const gainScale = yoyodyneScoreGainScale(state.notes);
  for (const occurrence of plan.entries) {
    void audio.schedule(occurrence.note, {
      startAt: occurrence.startAt,
      tempo: state.tempo,
      character: state.character,
      gainScale,
    }).catch((error) => handleAudioFailure(error, generation));
  }
}

function startAudioScheduler() {
  stopAudioScheduler();
  if (!state.playing || state.frozen || !state.audioOn || !audio.running) return;
  scheduleAudioWindow();
  state.schedulerId = globalThis.setInterval(
    scheduleAudioWindow,
    YOYODYNE_AUDIO_TIMING.schedulerIntervalMilliseconds,
  );
  syncTransportDiagnostics();
}

function reconcileScheduledAudio({
  score = currentScoreBeat(),
  leadSeconds = 0,
} = {}) {
  if (!state.audioOn || !audio.running) return;
  audio.cancelScheduled();
  state.schedulerGeneration += 1;
  state.scoreAnchorBeat = Math.max(0, score);
  state.performanceAnchorMs = performance.now();
  state.audioAnchorTime = audio.currentTime + Math.max(0, leadSeconds);
  state.nextEventOrdinal = 0;
  startAudioScheduler();
  syncTransportDiagnostics();
}

function setPlaying(next) {
  const requested = Boolean(next);
  if (requested === state.playing) return;
  if (requested) {
    state.playing = true;
    state.frozen = false;
    state.performanceAnchorMs = performance.now();
    if (state.audioOn && audio.running) {
      reconcileScheduledAudio({
        score: state.scoreAnchorBeat,
        leadSeconds: YOYODYNE_AUDIO_TIMING.startLeadSeconds,
      });
      $("transportNotice").textContent = "";
    } else {
      $("transportNotice").textContent = "Audio is off — turn it on to hear playback";
    }
    rebaseMidiPreview(state.scoreAnchorBeat, { includeCurrent: true });
    announce(state.audioOn && audio.running
      ? "Yoyodyne loop playing."
      : "Yoyodyne loop playing silently. Audio is off — turn it on to hear playback.");
  } else {
    state.scoreAnchorBeat = yoyodyneBeatWithinLoop(currentScoreBeat());
    state.performanceAnchorMs = performance.now();
    state.playing = false;
    state.audioAnchorTime = null;
    state.schedulerGeneration += 1;
    stopAudioScheduler();
    audio.cancelScheduled();
    audio.silence();
    state.midiPreviewBeat = null;
    $("transportNotice").textContent = "";
    announce("Yoyodyne loop paused.");
  }
  syncUi();
}

function stopTransport() {
  state.playing = false;
  state.frozen = false;
  state.scoreAnchorBeat = 0;
  state.performanceAnchorMs = performance.now();
  state.audioAnchorTime = null;
  state.nextEventOrdinal = 0;
  state.midiPreviewBeat = null;
  state.schedulerGeneration += 1;
  stopAudioScheduler();
  audio.cancelScheduled();
  audio.silence();
  $("transportNotice").textContent = "";
  syncUi();
  announce("Yoyodyne stopped at the beginning.");
}

async function toggleAudio() {
  if (state.audioStarting) return;
  clearError();
  if (state.audioOn) {
    const score = currentScoreBeat();
    state.audioOn = false;
    state.scoreAnchorBeat = score;
    state.performanceAnchorMs = performance.now();
    state.audioAnchorTime = null;
    state.schedulerGeneration += 1;
    stopAudioScheduler();
    audio.cancelScheduled();
    audio.silence();
    detachAudioStateObserver();
    setAudioUi();
    if (state.playing) {
      $("transportNotice").textContent = "Audio is off — turn it on to hear playback";
    }
    try {
      await audio.close();
    } catch (error) {
      showError(error);
    }
    announce("Yoyodyne audio off. The visual loop is unchanged.");
    return;
  }

  state.audioStarting = true;
  setAudioUi();
  try {
    await audio.arm();
    audio.setLevel(state.outputLevel);
    state.audioOn = true;
    observeAudioState();
    $("transportNotice").textContent = "";
    if (state.playing) {
      const score = performanceScoreBeat();
      reconcileScheduledAudio({ score });
      $("transportNotice").textContent = "";
      announce("Yoyodyne audio on, joined at the current loop position.");
    } else {
      announce("Yoyodyne audio on. Play the loop or ping a cell.");
    }
  } catch (error) {
    state.audioOn = false;
    showError(error);
    detachAudioStateObserver();
    try {
      await audio.close();
    } catch {
      // The failed context needs no further action.
    }
  } finally {
    state.audioStarting = false;
    setAudioUi();
  }
}

function auditionSelected({ announceChange = true } = {}) {
  const note = selectedNote();
  if (!note) return;
  if (!state.audioOn || !audio.running) {
    $("transportNotice").textContent = "Audio is off — turn it on to hear playback";
    if (announceChange) announce("Audio is off. Turn it on to ping the selected cell.");
    return;
  }
  const now = performance.now();
  if (now - state.lastPreviewMs < PREVIEW_RETRIGGER_MILLISECONDS) return;
  state.lastPreviewMs = now;
  const generation = state.schedulerGeneration;
  void audio.preview(note, { character: state.character })
    .then((result) => {
      if (generation !== state.schedulerGeneration || !result?.scheduled) return;
      publishMidiNotePreview(note, {
        source: "Selected cell ping",
        sourceId: "yoyodyne-ping",
        voiceId: `ping:${note.id}`,
        durationMs: YOYODYNE_AUDIO_LIMITS.previewDurationSeconds * 1_000,
      });
    })
    .catch((error) => handleAudioFailure(error, generation));
  if (announceChange) announce(`Pinged cell ${String(cellNumber(note)).padStart(2, "0")}, ${formatYoyodynePitch(note.pitch)}.`);
}

function pushUndo(notes) {
  const snapshot = cloneNotes(notes);
  const previous = state.undoStack.at(-1);
  if (previous && sameNotes(previous, snapshot)) return;
  state.undoStack.push(snapshot);
  if (state.undoStack.length > MAX_UNDO_STATES) state.undoStack.shift();
}

function selectCell(noteId, { announceChange = false } = {}) {
  const note = state.notes.find((entry) => entry.id === noteId);
  if (!note) return;
  state.selectedId = note.id;
  syncSelectedUi();
  if (announceChange) {
    announce(`Selected cell ${String(cellNumber(note)).padStart(2, "0")}, ${formatYoyodynePitch(note.pitch)}.`);
  }
}

function queueEditReconcile({ immediate = false } = {}) {
  if (state.editReconcileId) clearTimeout(state.editReconcileId);
  state.editReconcileId = 0;
  if (!state.playing || !state.audioOn || !audio.running || state.frozen) return;
  const run = () => {
    state.editReconcileId = 0;
    reconcileScheduledAudio();
  };
  if (immediate) run();
  else state.editReconcileId = globalThis.setTimeout(run, 55);
}

function replaceNotes(nextNotes, {
  before = null,
  remember = false,
  message = "",
  preview = false,
  immediate = false,
} = {}) {
  const next = cloneNotes(nextNotes);
  if (sameNotes(next, state.notes)) return false;
  if (remember && before) pushUndo(before);
  state.notes = next;
  rebaseMidiPreview();
  if (!state.notes.some((note) => note.id === state.selectedId)) {
    state.selectedId = state.notes[0]?.id ?? "";
  }
  queueEditReconcile({ immediate });
  syncUi();
  if (preview) auditionSelected({ announceChange: false });
  if (message) announce(message);
  return true;
}

function editSelected(changes, {
  remember = true,
  preview = false,
  message = "",
  pitchSnap = state.pitchSnap,
  timeSnap = state.timeSnap,
} = {}) {
  const note = selectedNote();
  if (!note) return false;
  const before = cloneNotes(state.notes);
  const next = updateYoyodyneNote(state.notes, note.id, changes, {
    pitchSnap,
    timeSnap,
  });
  return replaceNotes(next, {
    before,
    remember,
    preview,
    message,
    immediate: remember,
  });
}

function undo() {
  const previous = state.undoStack.pop();
  if (!previous) return;
  state.notes = cloneNotes(previous);
  rebaseMidiPreview();
  queueEditReconcile({ immediate: true });
  syncUi();
  auditionSelected({ announceChange: false });
  announce("Undid the last Yoyodyne edit.");
}

function recallSelected() {
  const note = selectedNote();
  if (!note) return;
  const before = cloneNotes(state.notes);
  const next = restoreYoyodyneNote(state.notes, note.id, originals);
  replaceNotes(next, {
    before,
    remember: true,
    preview: true,
    immediate: true,
    message: `Recalled cell ${String(cellNumber(note)).padStart(2, "0")}.`,
  });
}

function recallAll() {
  const score = currentScoreBeat();
  const before = cloneNotes(state.notes);
  if (!sameNotes(before, originals)) pushUndo(before);
  state.notes = createYoyodynePhrase();
  rebaseMidiPreview(score);
  state.selectedId = "sig-01";
  state.pitchSnap = "chromatic";
  state.timeSnap = "eighth";
  state.tempo = 96;
  state.character = 0.42;
  state.outputLevel = 0.34;
  audio.setLevel(state.outputLevel);
  state.scoreAnchorBeat = score;
  state.performanceAnchorMs = performance.now();
  if (state.playing && state.audioOn && audio.running) {
    reconcileScheduledAudio({ score });
  }
  syncUi();
  announce("Recalled the complete Yoyodyne phrase.");
}

function beginControlEdit() {
  if (!state.controlBefore) state.controlBefore = cloneNotes(state.notes);
}

function commitControlEdit(message) {
  const before = state.controlBefore;
  state.controlBefore = null;
  if (!before || sameNotes(before, state.notes)) return;
  pushUndo(before);
  queueEditReconcile({ immediate: true });
  syncUi();
  auditionSelected({ announceChange: false });
  if (message) announce(message);
}

function updateSelectedFromControl(changes) {
  beginControlEdit();
  const note = selectedNote();
  if (!note) return;
  state.notes = updateYoyodyneNote(state.notes, note.id, changes, {
    pitchSnap: state.pitchSnap,
    timeSnap: state.timeSnap,
  });
  rebaseMidiPreview();
  queueEditReconcile();
  syncSelectedUi();
}

function resizeCanvas() {
  const rect = canvas.getBoundingClientRect();
  const cssWidth = Math.max(1, rect.width);
  const cssHeight = Math.max(1, rect.height);
  const requestedDpr = Math.min(2, globalThis.devicePixelRatio || 1);
  const budgetDpr = Math.sqrt(CANVAS_PIXEL_BUDGET / Math.max(1, cssWidth * cssHeight));
  const dpr = Math.max(1, Math.min(requestedDpr, budgetDpr));
  const width = Math.max(1, Math.round(cssWidth * dpr));
  const height = Math.max(1, Math.round(cssHeight * dpr));
  if (canvas.width !== width || canvas.height !== height) {
    canvas.width = width;
    canvas.height = height;
  }
  state.cssWidth = cssWidth;
  state.cssHeight = cssHeight;
  state.dpr = dpr;
  const compact = cssWidth < 620;
  const left = compact ? 43 : 62;
  const right = compact ? 10 : 18;
  const top = compact ? 25 : 29;
  const bottom = compact ? 24 : 28;
  const plotWidth = Math.max(1, cssWidth - left - right);
  const plotHeight = Math.max(1, cssHeight - top - bottom);
  const laneCount = YOYODYNE_LIMITS.maximumPitch - YOYODYNE_LIMITS.minimumPitch + 1;
  state.geometry = Object.freeze({
    compact,
    left,
    right,
    top,
    bottom,
    plotWidth,
    plotHeight,
    laneHeight: plotHeight / laneCount,
  });
}

function beatToX(beat) {
  const geometry = state.geometry;
  return geometry.left + beat / YOYODYNE_LIMITS.loopBeats * geometry.plotWidth;
}

function pitchToY(pitch) {
  const geometry = state.geometry;
  return geometry.top
    + (YOYODYNE_LIMITS.maximumPitch - pitch + 0.5) * geometry.laneHeight;
}

function signalCellPath(target, rect, inset = 0) {
  const x = rect.x + inset;
  const y = rect.y + inset;
  const width = Math.max(1, rect.width - inset * 2);
  const height = Math.max(1, rect.height - inset * 2);
  const bevel = Math.min(height * 0.42, width * 0.18, 5);
  target.beginPath();
  target.moveTo(x, y + height / 2);
  target.lineTo(x + bevel, y);
  target.lineTo(x + width - bevel, y);
  target.lineTo(x + width, y + height / 2);
  target.lineTo(x + width - bevel, y + height);
  target.lineTo(x + bevel, y + height);
  target.closePath();
}

function drawGrid() {
  const geometry = state.geometry;
  const width = state.cssWidth;
  const height = state.cssHeight;
  const blackPitchClasses = new Set([1, 3, 6, 8, 10]);
  context.fillStyle = "#050811";
  context.fillRect(0, 0, width, height);

  const haze = context.createRadialGradient(
    geometry.left + geometry.plotWidth * 0.62,
    geometry.top + geometry.plotHeight * 0.38,
    0,
    geometry.left + geometry.plotWidth * 0.62,
    geometry.top + geometry.plotHeight * 0.38,
    geometry.plotWidth * 0.7,
  );
  haze.addColorStop(0, `rgba(69, 51, 139, ${0.08 + state.character * 0.18})`);
  haze.addColorStop(0.5, `rgba(20, 84, 110, ${0.035 + state.character * 0.07})`);
  haze.addColorStop(1, "rgba(5, 8, 17, 0)");
  context.fillStyle = haze;
  context.fillRect(geometry.left, geometry.top, geometry.plotWidth, geometry.plotHeight);

  for (let pitch = YOYODYNE_LIMITS.minimumPitch; pitch <= YOYODYNE_LIMITS.maximumPitch; pitch += 1) {
    const centerY = pitchToY(pitch);
    const topY = centerY - geometry.laneHeight / 2;
    if (blackPitchClasses.has(((pitch % 12) + 12) % 12)) {
      context.fillStyle = "rgba(63, 72, 108, 0.055)";
      context.fillRect(geometry.left, topY, geometry.plotWidth, geometry.laneHeight);
    }
    context.strokeStyle = pitch % 12 === 0
      ? "rgba(123, 154, 212, 0.23)"
      : "rgba(102, 127, 176, 0.09)";
    context.lineWidth = pitch % 12 === 0 ? 1 : 0.7;
    context.beginPath();
    context.moveTo(geometry.left, topY);
    context.lineTo(geometry.left + geometry.plotWidth, topY);
    context.stroke();
    if (pitch % 12 === 0) {
      context.fillStyle = "rgba(154, 173, 211, 0.62)";
      context.font = `600 ${geometry.compact ? 8 : 9}px ui-monospace, monospace`;
      context.textAlign = "right";
      context.textBaseline = "middle";
      context.fillText(formatYoyodynePitch(pitch), geometry.left - 7, centerY);
    }
  }

  for (let halfBeat = 0; halfBeat <= YOYODYNE_LIMITS.loopBeats * 2; halfBeat += 1) {
    const beat = halfBeat / 2;
    const x = beatToX(beat);
    const isBar = Number.isInteger(beat / YOYODYNE_LIMITS.beatsPerBar);
    const isBeat = Number.isInteger(beat);
    context.strokeStyle = isBar
      ? "rgba(101, 247, 255, 0.28)"
      : isBeat ? "rgba(121, 150, 204, 0.16)" : "rgba(112, 137, 187, 0.07)";
    context.lineWidth = isBar ? 1.2 : 0.7;
    context.beginPath();
    context.moveTo(x, geometry.top);
    context.lineTo(x, geometry.top + geometry.plotHeight);
    context.stroke();
    if (isBeat && beat < YOYODYNE_LIMITS.loopBeats) {
      context.fillStyle = isBar
        ? "rgba(101, 247, 255, 0.68)"
        : "rgba(139, 155, 190, 0.48)";
      context.font = "600 8px ui-monospace, monospace";
      context.textAlign = "left";
      context.textBaseline = "bottom";
      context.fillText(String(beat + 1).padStart(2, "0"), x + 4, geometry.top - 5);
    }
  }

  context.strokeStyle = "rgba(139, 163, 211, 0.24)";
  context.lineWidth = 1;
  context.strokeRect(geometry.left, geometry.top, geometry.plotWidth, geometry.plotHeight);
}

function noteRect(note) {
  const geometry = state.geometry;
  const x = beatToX(note.startBeat);
  const logicalWidth = note.durationBeats / YOYODYNE_LIMITS.loopBeats * geometry.plotWidth;
  const width = Math.max(geometry.compact ? 13 : 9, logicalWidth);
  const height = Math.max(10, Math.min(18, geometry.laneHeight * 0.76));
  const y = pitchToY(note.pitch) - height / 2;
  return { x, y, width, height, logicalWidth };
}

function drawGhost(note) {
  const rect = noteRect(note);
  const centerY = rect.y + rect.height / 2;
  const startX = rect.x;
  const endX = rect.x + rect.width;
  context.save();
  context.setLineDash([2, 4]);
  context.lineWidth = 1;
  context.strokeStyle = "rgba(158, 177, 217, 0.26)";
  context.beginPath();
  context.moveTo(startX, centerY);
  context.lineTo(endX, centerY);
  context.stroke();
  context.setLineDash([]);
  context.strokeStyle = "rgba(166, 185, 226, 0.34)";
  for (const x of [startX, endX]) {
    context.beginPath();
    context.moveTo(x - 2.5, centerY);
    context.lineTo(x + 2.5, centerY);
    context.moveTo(x, centerY - 2.5);
    context.lineTo(x, centerY + 2.5);
    context.stroke();
  }
  context.restore();
}

function drawSignalCell(note, activeIds) {
  const rect = noteRect(note);
  const selected = note.id === state.selectedId;
  const active = activeIds.has(note.id);
  const charge = state.character;
  const roleColors = RELAY_ROLE_VISUALS[note.voiceRole] ?? RELAY_ROLE_VISUALS.mouth;
  const gradient = context.createLinearGradient(rect.x, rect.y, rect.x + rect.width, rect.y + rect.height);
  gradient.addColorStop(0, selected ? "#73fbff" : roleColors[0]);
  gradient.addColorStop(0.56, selected ? "#9a8dff" : roleColors[1]);
  gradient.addColorStop(1, active ? "#ff77d5" : roleColors[2]);

  context.save();
  if (selected || active) {
    context.shadowColor = active ? "rgba(255, 95, 206, 0.72)" : "rgba(101, 247, 255, 0.56)";
    context.shadowBlur = (active ? 15 : 10) + charge * 7;
  }
  context.globalAlpha = 0.55 + note.energy * 0.4;
  context.fillStyle = gradient;
  signalCellPath(context, rect);
  context.fill();
  context.shadowBlur = 0;
  context.globalAlpha = 1;
  context.strokeStyle = active
    ? "rgba(255, 240, 253, 0.95)"
    : selected ? "rgba(235, 255, 255, 0.95)" : "rgba(180, 221, 243, 0.44)";
  context.lineWidth = selected || active ? 1.3 : 0.75;
  signalCellPath(context, rect);
  context.stroke();

  signalCellPath(context, rect, 1);
  context.clip();
  const bends = note.bendCents;
  const relayNodes = [];
  bends.forEach((cents, index) => {
    const x = rect.x + 2 + (rect.width - 4) * index / Math.max(1, bends.length - 1);
    const y = rect.y + rect.height / 2 - cents / 100 * state.geometry.laneHeight;
    relayNodes.push({ x, y });
  });
  context.beginPath();
  relayNodes.forEach(({ x, y }, index) => {
    if (index === 0) context.moveTo(x, y);
    else context.lineTo(x, y);
  });
  context.strokeStyle = "rgba(5, 15, 27, 0.82)";
  context.lineWidth = 0.85 + charge * 0.85;
  context.stroke();
  context.fillStyle = active ? "#fff5fd" : "rgba(5, 15, 27, 0.9)";
  for (const { x, y } of relayNodes) {
    context.beginPath();
    context.arc(x, y, 1.05 + charge * 0.85, 0, Math.PI * 2);
    context.fill();
    if (charge > 0.58) {
      const ray = 1.5 + charge * 1.5;
      context.strokeStyle = `rgba(240, 252, 255, ${0.18 + charge * 0.28})`;
      context.lineWidth = 0.55;
      context.beginPath();
      context.moveTo(x - ray, y);
      context.lineTo(x + ray, y);
      context.moveTo(x, y - ray);
      context.lineTo(x, y + ray);
      context.stroke();
    }
  }
  context.restore();

  if (rect.width >= 28) {
    context.fillStyle = selected ? "#06131b" : "rgba(245, 250, 255, 0.86)";
    context.font = `800 ${rect.width < 32 ? 7 : 8}px ui-monospace, monospace`;
    context.textAlign = "center";
    context.textBaseline = "middle";
    context.fillText(
      `${RELAY_ROLE_MARKS[note.voiceRole] ?? "M"}${String(cellNumber(note)).padStart(2, "0")}`,
      rect.x + rect.width / 2,
      rect.y + rect.height / 2 + 0.5,
    );
  }

  if (selected) {
    context.save();
    context.strokeStyle = "rgba(200, 255, 106, 0.92)";
    context.lineWidth = 2.4;
    context.beginPath();
    context.moveTo(rect.x + 1, rect.y + 2);
    context.lineTo(rect.x + 1, rect.y + rect.height - 2);
    context.moveTo(rect.x + rect.width - 1, rect.y + 2);
    context.lineTo(rect.x + rect.width - 1, rect.y + rect.height - 2);
    context.stroke();
    context.restore();
  }

  const coarse = globalThis.matchMedia?.("(pointer: coarse)")?.matches === true;
  const hitHeight = Math.max(rect.height + 6, coarse ? 28 : 16);
  const hitWidth = Math.max(rect.width, coarse ? 20 : rect.width);
  state.hitRegions.push(Object.freeze({
    id: note.id,
    x: rect.x,
    y: rect.y,
    width: rect.width,
    height: rect.height,
    hitX: rect.x - (hitWidth - rect.width) / 2,
    hitY: rect.y - (hitHeight - rect.height) / 2,
    hitWidth,
    hitHeight,
    handleWidth: Math.min(coarse ? 12 : 8, Math.max(3, rect.width * 0.24)),
  }));
}

function drawPlayhead(scoreBeat) {
  const geometry = state.geometry;
  const beat = yoyodyneBeatWithinLoop(scoreBeat);
  const x = beatToX(beat);
  context.save();
  context.strokeStyle = state.playing
    ? "rgba(200, 255, 106, 0.96)"
    : "rgba(200, 255, 106, 0.42)";
  context.lineWidth = state.playing ? 1.5 : 1;
  context.shadowColor = "rgba(200, 255, 106, 0.66)";
  context.shadowBlur = state.playing ? 8 : 0;
  context.beginPath();
  context.moveTo(x, geometry.top - 4);
  context.lineTo(x, geometry.top + geometry.plotHeight);
  context.stroke();
  context.shadowBlur = 0;
  context.fillStyle = "rgba(200, 255, 106, 0.98)";
  context.beginPath();
  context.moveTo(x - 4, geometry.top - 5);
  context.lineTo(x + 4, geometry.top - 5);
  context.lineTo(x, geometry.top + 1);
  context.closePath();
  context.fill();
  context.restore();
}

function drawScene(scoreBeat = currentScoreBeat()) {
  if (!context || !state.geometry) return;
  context.setTransform(state.dpr, 0, 0, state.dpr, 0, 0);
  context.clearRect(0, 0, state.cssWidth, state.cssHeight);
  drawGrid();
  for (const original of originals) drawGhost(original);
  const active = state.playing ? yoyodyneNotesAtBeat(state.notes, scoreBeat) : [];
  const activeIds = new Set(active.map(({ id }) => id));
  state.hitRegions = [];
  for (const note of state.notes) drawSignalCell(note, activeIds);
  drawPlayhead(scoreBeat);
  const beat = yoyodyneBeatWithinLoop(scoreBeat);
  canvas.dataset.positionBeat = beat.toFixed(3);
  canvas.dataset.activeId = active[0]?.id ?? "";
  canvas.dataset.activeIds = active.map(({ id }) => id).join(" ");
  canvas.dataset.activeRoles = active.map(({ voiceRole }) => voiceRole).join(" ");
  canvas.dataset.characterVisual = state.character.toFixed(2);
  $("transportReadout").textContent = formatTransportBeat(scoreBeat);
  state.needsDraw = false;
}

function animate(timestamp) {
  const frameRate = state.geometry?.compact ? 24 : 30;
  const scoreBeat = currentScoreBeat(timestamp);
  publishMidiTransportOnsets(scoreBeat);
  if (
    (state.playing || state.drag || state.needsDraw)
    && timestamp - state.lastFrameMs >= 1_000 / frameRate
  ) {
    state.lastFrameMs = timestamp;
    drawScene(scoreBeat);
  }
  state.frameId = requestAnimationFrame(animate);
}

function canvasPoint(event) {
  const rect = canvas.getBoundingClientRect();
  return {
    x: clampYoyodyne(event.clientX - rect.left, 0, rect.width, 0),
    y: clampYoyodyne(event.clientY - rect.top, 0, rect.height, 0),
  };
}

function hitTest(point) {
  const matches = state.hitRegions.filter((region) => (
    point.x >= region.hitX
    && point.x <= region.hitX + region.hitWidth
    && point.y >= region.hitY
    && point.y <= region.hitY + region.hitHeight
  ));
  matches.sort((left, right) => {
    const leftDistance = (point.x - (left.x + left.width / 2)) ** 2
      + (point.y - (left.y + left.height / 2)) ** 2;
    const rightDistance = (point.x - (right.x + right.width / 2)) ** 2
      + (point.y - (right.y + right.height / 2)) ** 2;
    return leftDistance - rightDistance;
  });
  return matches[0] ?? null;
}

function showPointerReadout(note, event) {
  const wrapRect = $("stageWrap").getBoundingClientRect();
  const output = $("pointerReadout");
  output.hidden = false;
  output.textContent = `${formatYoyodynePitch(note.pitch)} · beat ${formatBeat(note.startBeat + 1)} · ${formatBeat(note.durationBeats)} long`;
  const x = clampYoyodyne(event.clientX - wrapRect.left + 13, 8, Math.max(8, wrapRect.width - 150), 8);
  const y = clampYoyodyne(event.clientY - wrapRect.top - 32, 8, Math.max(8, wrapRect.height - 36), 8);
  output.style.left = `${x}px`;
  output.style.top = `${y}px`;
}

function beginPointer(event) {
  if (event.button !== undefined && event.button !== 0) return;
  const point = canvasPoint(event);
  const hit = hitTest(point);
  if (!hit) return;
  const note = state.notes.find((entry) => entry.id === hit.id);
  if (!note) return;
  event.preventDefault();
  canvas.setPointerCapture?.(event.pointerId);
  canvas.focus({ preventScroll: true });
  selectCell(note.id);
  const localX = point.x - hit.x;
  let mode = "pending";
  if (localX <= hit.handleWidth) mode = "resize-left";
  else if (localX >= hit.width - hit.handleWidth) mode = "resize-right";
  state.drag = {
    pointerId: event.pointerId,
    noteId: note.id,
    mode,
    originPoint: point,
    note,
    beforeNotes: cloneNotes(state.notes),
    moved: false,
  };
  canvas.dataset.dragMode = mode;
  showPointerReadout(note, event);
}

function movePointer(event) {
  const drag = state.drag;
  if (!drag || drag.pointerId !== event.pointerId) return;
  event.preventDefault();
  const point = canvasPoint(event);
  const dx = point.x - drag.originPoint.x;
  const dy = point.y - drag.originPoint.y;
  if (drag.mode === "pending" && Math.hypot(dx, dy) >= 4) {
    drag.mode = Math.abs(dy) > Math.abs(dx) ? "move-pitch" : "move-time";
    canvas.dataset.dragMode = drag.mode;
  }
  if (drag.mode === "pending") return;

  const beatDelta = dx / state.geometry.plotWidth * YOYODYNE_LIMITS.loopBeats;
  const pitchDelta = -dy / state.geometry.laneHeight;
  const note = drag.note;
  let changes = null;
  if (drag.mode === "move-pitch") {
    changes = { pitch: note.pitch + pitchDelta };
  } else if (drag.mode === "move-time") {
    changes = { startBeat: note.startBeat + beatDelta };
  } else if (drag.mode === "resize-left") {
    const end = note.startBeat + note.durationBeats;
    const nextStart = clampYoyodyne(
      note.startBeat + beatDelta,
      0,
      end - YOYODYNE_LIMITS.minimumDurationBeats,
      note.startBeat,
    );
    changes = {
      startBeat: nextStart,
      durationBeats: end - nextStart,
    };
  } else if (drag.mode === "resize-right") {
    changes = { durationBeats: note.durationBeats + beatDelta };
  }
  if (!changes) return;
  const next = updateYoyodyneNote(drag.beforeNotes, note.id, changes, {
    pitchSnap: state.pitchSnap,
    timeSnap: state.timeSnap,
  });
  if (sameNotes(next, state.notes)) return;
  state.notes = next;
  rebaseMidiPreview();
  drag.moved = !sameNotes(next, drag.beforeNotes);
  syncSelectedUi();
  queueEditReconcile();
  const edited = selectedNote();
  if (edited) showPointerReadout(edited, event);
}

function finishPointer(event, { cancelled = false } = {}) {
  const drag = state.drag;
  if (!drag || drag.pointerId !== event.pointerId) return;
  state.drag = null;
  delete canvas.dataset.dragMode;
  $("pointerReadout").hidden = true;
  try {
    if (canvas.hasPointerCapture?.(event.pointerId)) {
      canvas.releasePointerCapture(event.pointerId);
    }
  } catch {
    // Pointer capture may already be gone after a browser cancellation.
  }
  if (cancelled) {
    state.notes = drag.beforeNotes;
    rebaseMidiPreview();
    queueEditReconcile({ immediate: true });
    syncUi();
    announce("Cancelled the signal-cell edit.");
    return;
  }
  if (!drag.moved) {
    auditionSelected({ announceChange: false });
    announce(`Selected cell ${String(cellNumber(selectedNote())).padStart(2, "0")}.`);
    return;
  }
  pushUndo(drag.beforeNotes);
  queueEditReconcile({ immediate: true });
  syncUi();
  auditionSelected({ announceChange: false });
  const note = selectedNote();
  const action = drag.mode === "move-pitch"
    ? "retuned"
    : drag.mode === "move-time" ? "moved through time" : "resized";
  announce(`Cell ${String(cellNumber(note)).padStart(2, "0")} ${action}: ${formatYoyodynePitch(note.pitch)}, beat ${formatBeat(note.startBeat + 1)}, ${formatBeat(note.durationBeats)} beats.`);
}

function handleCanvasKeydown(event) {
  if (event.altKey || event.ctrlKey || event.metaKey) return;
  const numeric = Number(event.key);
  if (/^[1-9]$/.test(event.key) && state.notes[numeric - 1]) {
    event.preventDefault();
    selectCell(state.notes[numeric - 1].id, { announceChange: true });
    return;
  }
  if (event.key === "PageDown" || event.key === "PageUp") {
    event.preventDefault();
    const index = Math.max(0, state.notes.findIndex((note) => note.id === state.selectedId));
    const direction = event.key === "PageDown" ? 1 : -1;
    const nextIndex = (index + direction + state.notes.length) % state.notes.length;
    selectCell(state.notes[nextIndex].id, { announceChange: true });
    return;
  }
  if (event.key === "Enter") {
    event.preventDefault();
    auditionSelected();
    return;
  }
  if (event.key.toLowerCase() === "r") {
    event.preventDefault();
    recallSelected();
    return;
  }

  const note = selectedNote();
  if (!note) return;
  const pitchStep = state.pitchSnap === "chromatic"
    ? (event.shiftKey ? 12 : 1)
    : (event.shiftKey ? 1 : 0.1);
  const timeStep = state.timeSnap === "eighth"
    ? (event.shiftKey ? 2 : 0.5)
    : (event.shiftKey ? 0.5 : 0.05);
  let changes = null;
  let action = "";
  if (event.key === "ArrowUp") {
    changes = { pitch: note.pitch + pitchStep };
    action = "raised";
  } else if (event.key === "ArrowDown") {
    changes = { pitch: note.pitch - pitchStep };
    action = "lowered";
  } else if (event.key === "ArrowLeft") {
    changes = { startBeat: note.startBeat - timeStep };
    action = "moved earlier";
  } else if (event.key === "ArrowRight") {
    changes = { startBeat: note.startBeat + timeStep };
    action = "moved later";
  } else if (event.key === "[") {
    changes = { durationBeats: note.durationBeats - timeStep };
    action = "shortened";
  } else if (event.key === "]") {
    changes = { durationBeats: note.durationBeats + timeStep };
    action = "lengthened";
  }
  if (!changes) return;
  event.preventDefault();
  editSelected(changes, {
    remember: true,
    preview: true,
    message: `Cell ${String(cellNumber(note)).padStart(2, "0")} ${action}.`,
  });
}

function bindSelectedRange(id, readChanges, message) {
  const input = $(id);
  input.addEventListener("pointerdown", beginControlEdit);
  input.addEventListener("keydown", beginControlEdit);
  input.addEventListener("input", () => updateSelectedFromControl(readChanges(input)));
  input.addEventListener("change", () => commitControlEdit(message));
  input.addEventListener("blur", () => {
    if (state.controlBefore) commitControlEdit(message);
  });
}

function updateTempo(value) {
  const score = currentScoreBeat();
  state.tempo = Math.round(clampYoyodyne(
    value,
    YOYODYNE_LIMITS.minimumTempo,
    YOYODYNE_LIMITS.maximumTempo,
    96,
  ));
  state.scoreAnchorBeat = score;
  state.performanceAnchorMs = performance.now();
  rebaseMidiPreview(score);
  if (state.playing && state.audioOn && audio.running) {
    reconcileScheduledAudio({ score });
  }
  syncUi();
}

function bindControls() {
  $("audioButton").addEventListener("click", () => void toggleAudio());
  $("playButton").addEventListener("click", () => setPlaying(!state.playing));
  $("stopButton").addEventListener("click", stopTransport);
  $("auditionButton").addEventListener("click", () => auditionSelected());
  $("undoButton").addEventListener("click", undo);
  $("resetSelected").addEventListener("click", recallSelected);
  $("resetAll").addEventListener("click", recallAll);
  $("resetAllTop").addEventListener("click", recallAll);

  $("pitchSnap").addEventListener("change", (event) => {
    state.pitchSnap = event.currentTarget.value === "free" ? "free" : "chromatic";
    syncUi();
    announce(`Pitch lock set to ${state.pitchSnap === "free" ? "free cents" : "chromatic"}.`);
  });
  $("timeSnap").addEventListener("change", (event) => {
    state.timeSnap = event.currentTarget.value === "free" ? "free" : "eighth";
    syncUi();
    announce(`Time lock set to ${state.timeSnap === "free" ? "free time" : "one eighth note, half a beat"}.`);
  });

  bindSelectedRange(
    "selectedPitch",
    (input) => ({ pitch: Number(input.value) }),
    "Changed the selected cell pitch.",
  );
  bindSelectedRange(
    "selectedStart",
    (input) => ({ startBeat: Number(input.value) }),
    "Changed the selected cell start time.",
  );
  bindSelectedRange(
    "selectedDuration",
    (input) => ({ durationBeats: Number(input.value) }),
    "Changed the selected cell duration.",
  );

  $("tempo").addEventListener("input", (event) => updateTempo(event.currentTarget.value));
  $("tempo").addEventListener("change", () => announce(`Tempo set to ${state.tempo} BPM without stopping the loop.`));
  $("character").addEventListener("input", (event) => {
    state.character = clampYoyodyne(event.currentTarget.value, 0, 1, 0.42);
    queueEditReconcile();
    syncUi();
  });
  $("character").addEventListener("change", () => {
    queueEditReconcile({ immediate: true });
    auditionSelected({ announceChange: false });
    announce(`Signal character set to ${characterName()}.`);
  });
  $("outputLevel").addEventListener("input", (event) => {
    state.outputLevel = clampYoyodyne(event.currentTarget.value, 0, 0.8, 0.34);
    audio.setLevel(state.outputLevel);
    syncUi();
  });

  canvas.addEventListener("pointerdown", beginPointer);
  canvas.addEventListener("pointermove", movePointer);
  canvas.addEventListener("pointerup", (event) => finishPointer(event));
  canvas.addEventListener("pointercancel", (event) => finishPointer(event, { cancelled: true }));
  canvas.addEventListener("lostpointercapture", (event) => {
    if (state.drag?.pointerId === event.pointerId) finishPointer(event, { cancelled: true });
  });
  canvas.addEventListener("keydown", handleCanvasKeydown);
  canvas.addEventListener("contextmenu", (event) => event.preventDefault());
}

function handleCanvasResize() {
  resizeCanvas();
  drawScene();
}

function observeCanvas() {
  state.resizeObserver?.disconnect?.();
  if (typeof ResizeObserver === "function") {
    state.resizeObserver = new ResizeObserver(() => {
      handleCanvasResize();
    });
    state.resizeObserver.observe($("stageWrap"));
  } else if (!state.resizeFallbackInstalled) {
    globalThis.addEventListener("resize", handleCanvasResize, { passive: true });
    state.resizeFallbackInstalled = true;
  }
}

function freezeForVisibility() {
  if (state.drag) {
    finishPointer(
      { pointerId: state.drag.pointerId },
      { cancelled: true },
    );
  }
  if (state.playing && !state.frozen) {
    state.scoreAnchorBeat = currentScoreBeat();
    state.performanceAnchorMs = performance.now();
  }
  state.frozen = true;
  state.midiPreviewBeat = null;
  state.schedulerGeneration += 1;
  stopAudioScheduler();
  if (state.editReconcileId) clearTimeout(state.editReconcileId);
  state.editReconcileId = 0;
  audio.cancelScheduled();
  audio.silence();
}

async function resumeFromVisibility() {
  if (!state.frozen || document.hidden) return;
  const generation = state.schedulerGeneration;
  state.frozen = false;
  state.performanceAnchorMs = performance.now();
  rebaseMidiPreview(state.scoreAnchorBeat);
  if (!state.playing || !state.audioOn) return;
  try {
    if (!audio.running) await audio.arm();
    if (
      generation !== state.schedulerGeneration
      || document.hidden
      || state.frozen
      || !state.playing
      || !state.audioOn
    ) {
      audio.cancelScheduled();
      audio.silence();
      if (document.hidden || state.frozen) {
        detachAudioStateObserver();
        await audio.close();
      }
      return;
    }
    observeAudioState();
    reconcileScheduledAudio({
      score: state.scoreAnchorBeat,
      leadSeconds: YOYODYNE_AUDIO_TIMING.startLeadSeconds,
    });
  } catch (error) {
    if (
      generation !== state.schedulerGeneration
      || document.hidden
      || state.frozen
    ) return;
    await handleAudioFailure(error, generation);
  }
}

function teardown({ closeAudio = true } = {}) {
  freezeForVisibility();
  if (state.frameId) cancelAnimationFrame(state.frameId);
  state.frameId = 0;
  state.resizeObserver?.disconnect?.();
  state.resizeObserver = null;
  if (state.resizeFallbackInstalled) {
    globalThis.removeEventListener("resize", handleCanvasResize);
    state.resizeFallbackInstalled = false;
  }
  if (closeAudio) {
    state.audioOn = false;
    detachAudioStateObserver();
    setAudioUi();
    void audio.close();
  }
}

function installLifecycle() {
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) {
      freezeForVisibility();
      return;
    }
    void resumeFromVisibility();
  });
  globalThis.addEventListener("blur", () => {
    if (state.drag) {
      finishPointer(
        { pointerId: state.drag.pointerId },
        { cancelled: true },
      );
    }
  });
  globalThis.addEventListener("pagehide", (event) => {
    teardown({ closeAudio: !event.persisted });
    canvas.dataset.pageLifecycle = event.persisted ? "cached" : "closed";
  });
  globalThis.addEventListener("pageshow", (event) => {
    if (!event.persisted) return;
    canvas.dataset.pageLifecycle = "restored";
    resizeCanvas();
    observeCanvas();
    if (!state.frameId) state.frameId = requestAnimationFrame(animate);
    void resumeFromVisibility();
  });
}

function initialize() {
  if (!context) {
    showError("Canvas 2D is not available in this browser.");
    return;
  }
  audio.setLevel(state.outputLevel);
  resizeCanvas();
  bindControls();
  installLifecycle();
  observeCanvas();
  syncUi();
  drawScene(0);
  canvas.dataset.modelReady = "true";
  state.frameId = requestAnimationFrame(animate);
}

initialize();

import {
  DEFAULT_GRAIN_MS, IDENTITY_ORIENTATION, MAX_GRAIN_MS, MIN_GRAIN_MS,
  PICKUP_REACH, SLICE_CELLS, SOURCE_COUNT, clamp, collectSweep,
  coveredSources, cutRibbon, floorRemaining, phaseAt, playRadius, rollPlayPose, wrap,
} from "./model.js";
import {
  MAX_FILE_BYTES, MAX_TOTAL_BYTES, SOURCE_NAMES, decodeLocalSource,
  decodeLocalSources, demoSource, sampleSource,
} from "./sources.js";
import { GlobuleAudio } from "./audio.js";
import { PLAY_PRESETS, RECORD_PRESETS, matchingPreset } from "./presets.js";
import { createGlobuleView } from "./view.js";

const $ = id => document.getElementById(id);
const canvas = $("stageCanvas");
const abort = new AbortController();
const on = (target, type, handler) => target.addEventListener(type, handler, { signal: abort.signal });
const sources = Array.from({ length: SOURCE_COUNT }, (_, index) =>
  ({ ...demoSource(index), floorId: index }));
const floorIds = () => sources.map(source => source.floorId);
let nextFloorId = SOURCE_COUNT;
const state = {
  mode: "record", ribbons: [], position: { phase: .15, lane: 3.5 },
  orientation: IDENTITY_ORIENTATION, playPose: IDENTITY_ORIENTATION,
  history: null, drag: null, sourceIndex: 0, busy: false,
  grainMs: DEFAULT_GRAIN_MS, grainMode: "fixed", grainSpreadMs: 60,
  phase: 0, anchorMs: performance.now(), playing: false, audioOn: false, starting: false,
  speed: 1, direction: 1, scatter: .68, needleWidth: 30, needle: 3.5, level: .58,
  active: null,
};
let view = null, disposed = false, raf = 0, lastPaint = -Infinity, dirty = true;
let audioAttempt = 0, resizeObserver = null;
let importAttempt = 0, micAttempt = 0, micSession = null;
const MAX_MIC_SECONDS = 30;

function announce(message) { $("globuleStatus").textContent = message; }
function showError(cause) {
  $("globuleError").textContent = cause?.message ?? String(cause);
  $("globuleError").hidden = false;
}
function clearError() { $("globuleError").hidden = true; }
function currentPhase(now = performance.now()) {
  if (state.audioOn && state.playing && audio.context?.state === "running") return audio.phase();
  return phaseAt(state, now);
}
function anchor(phase) {
  state.phase = wrap(phase);
  state.anchorMs = performance.now();
}
function render(now) {
  raf = 0;
  if (disposed || document.hidden) return;
  if (now - lastPaint > 30) {
    const phase = currentPhase(now);
    const touching = view?.render({
      mode: state.mode, sources, ribbons: state.ribbons, position: state.position,
      orientation: state.orientation, phase, needle: state.needle, wander: state.scatter,
      needleWidth: state.needleWidth, playPose: state.playPose,
      active: state.active,
    });
    if (state.mode === "play") {
      $("turnOut").textContent = `${Math.round(phase * 100)}% of roll`;
      $("contactStatus").textContent = touching
        ? `${touching} ${touching === 1 ? "zone" : "zones"} under the straw`
        : "Straw between zones · silence";
    }
    lastPaint = now;
    dirty = false;
  }
  if (dirty || (state.mode === "play" && state.playing))
    raf = requestAnimationFrame(render);
}
function requestDraw() {
  dirty = true;
  if (!raf && !disposed && !document.hidden) raf = requestAnimationFrame(render);
}
function snapshotBall() {
  return { ribbons: state.ribbons, position: { ...state.position },
    orientation: state.orientation };
}
function updatePosition() {
  $("mapPhase").value = String(state.position.phase);
  $("mapLane").value = String(state.position.lane);
  $("mapPhaseOut").textContent = `${Math.round(state.position.phase * 100)}%`;
  $("mapLaneOut").textContent = `${(state.position.lane + 1).toFixed(1)} / 8`;
  requestDraw();
}
function updateAudioButton() {
  $("audioButton").disabled = state.starting;
  $("audioButton").setAttribute("aria-pressed", String(state.audioOn));
  $("audioButton").setAttribute("aria-label", state.audioOn ? "Turn audio off" : "Turn audio on");
  $("audioState").textContent = state.starting ? "starting" : state.audioOn ? "on" : "off";
}
function updateTransport() {
  $("playButton").setAttribute("aria-pressed", String(state.playing));
  $("playButton").setAttribute("aria-label", state.playing ? "Pause collected grains" : "Play collected grains");
  $("transportState").textContent = state.playing
    ? (state.audioOn && state.ribbons.length ? "Collage turning" : "Silent orbit")
    : "Ball at rest";
}
function updateFloorStatus() {
  const remaining = floorRemaining(state.ribbons, floorIds());
  $("floorRemaining").textContent = remaining
    ? `${remaining} grain ${remaining === 1 ? "place" : "places"} left on the floor`
    : "Floor picked clean · lay fresh sounds to keep collecting";
}
function updateBall() {
  $("ribbonCount").textContent = String(state.ribbons.length);
  $("sourceCount").textContent = String(coveredSources(state.ribbons));
  $("collectionSummary").textContent = `${state.ribbons.length} ${state.ribbons.length === 1 ? "grain" : "grains"} stuck`;
  updateFloorStatus();
  $("undoButton").disabled = state.busy || !state.history || Boolean(state.drag);
  if (!state.ribbons.length) {
    state.active = null;
    $("nowReading").textContent = "The ball is empty. Collect some grain zones first.";
  } else if (!state.active)
    $("nowReading").textContent = "Straw has not touched a grain zone yet.";
  audio.setRibbons(state.ribbons, state.orientation, state.playPose);
  updateTransport();
  requestDraw();
}
function updateSource() {
  $("sourceLane").value = String(state.sourceIndex);
  $("sourceInfo").textContent = `${sources[state.sourceIndex].name}`
    + ` · ${{
      demo: "generated loop", sample: "generated sample",
      file: "local file", mic: "local mic take",
    }[sources[state.sourceIndex].kind]}`
    + ` · ${sources[state.sourceIndex].duration.toFixed(1)} s. All eight stay active.`;
  for (const [index, option] of [...$("sourceLane").options].entries())
    option.textContent = sources[index].name;
  $("sourceLane").disabled = state.busy;
  $("importButton").disabled = state.busy;
  $("sourceInput").disabled = state.busy;
  $("sampleSelect").disabled = state.busy;
  $("useSampleButton").disabled = state.busy;
  $("micButton").disabled = state.busy
    && !["permission", "recording"].includes(micSession?.phase);
  $("micButton").textContent = micSession?.phase === "permission" ? "× Cancel mic request"
    : micSession?.phase === "recording" ? "■ Finish mic take"
      : micSession ? "Processing mic take…" : "● Record mic on this ribbon";
  $("micButton").setAttribute("aria-pressed", String(micSession?.phase === "recording"));
  $("grainSize").disabled = state.busy;
  $("grainMode").disabled = state.busy;
  $("grainSpread").disabled = state.busy;
  $("recordPreset").disabled = state.busy || Boolean(state.drag);
  $("mapPhase").disabled = state.busy;
  $("mapLane").disabled = state.busy;
  $("pickButton").disabled = state.busy;
  $("resetButton").disabled = state.busy;
  $("undoButton").disabled = state.busy || !state.history || Boolean(state.drag);
  updateFloorStatus();
  requestDraw();
}
function updateRecordControls() {
  $("grainSize").value = String(state.grainMs);
  $("grainSizeOut").textContent = `${state.grainMs} ms`;
  $("grainMode").value = state.grainMode;
  $("grainSpread").value = String(state.grainSpreadMs);
  $("grainSpreadOut").textContent = `±${state.grainSpreadMs} ms`;
  $("grainSpreadField").hidden = state.grainMode !== "random";
  $("recordPreset").value = matchingPreset(RECORD_PRESETS, state);
  requestDraw();
}
function updatePlayControls() {
  $("spinSpeed").value = String(state.speed);
  $("spinSpeedOut").textContent = `${state.speed.toFixed(2)}×`;
  $("scatter").value = String(state.scatter);
  $("scatterOut").textContent = `${Math.round(state.scatter * 100)}%`;
  $("needleWidth").value = String(state.needleWidth);
  $("needleWidthOut").textContent = `${state.needleWidth}%`;
  $("needle").value = String(state.needle);
  const tilt = Math.round((3.5 - state.needle) * 180 / 7);
  $("needleOut").textContent = tilt === 0 ? "level"
    : `${Math.abs(tilt)}° ${tilt > 0 ? "north" : "south"}`;
  $("directionButton").setAttribute("aria-pressed", String(state.direction === -1));
  $("directionButton").textContent = state.direction === -1 ? "↷ Forward roll" : "↶ Reverse roll";
  $("output").value = String(state.level);
  $("outputOut").textContent = `${Math.round(state.level * 100)}%`;
  $("playPreset").value = matchingPreset(PLAY_PRESETS, state);
  requestDraw();
}
function setPlaying(playing) {
  const phase = currentPhase();
  anchor(phase);
  state.playing = Boolean(playing);
  audio.transport(state.playing, phase);
  updateTransport();
  requestDraw();
  announce(state.playing
    ? state.audioOn
      ? (state.ribbons.length ? "Straw reading grain zones." : "Ball empty · roll in Record.")
      : "Silent orbit · tap Audio to hear."
    : "Ball at rest.");
}
function setPhase(phase, resetSequence = false) {
  anchor(phase);
  audio.seek(state.phase, resetSequence);
  requestDraw();
}
function updateReader(changes) {
  // Rebase before changing speed or direction: no jump at the control boundary.
  const phase = currentPhase();
  anchor(phase);
  Object.assign(state, changes);
  audio.setControls({
    phase, speed: state.speed, direction: state.direction, scatter: state.scatter,
    needleWidth: state.needleWidth, needle: state.needle, playPose: state.playPose,
  });
  updatePlayControls();
}
function movePlayBall(dx, dy, radius) {
  if (!dx && !dy) return;
  const before = state.playPose;
  state.playPose = rollPlayPose(before, dx, dy, radius);
  const phase = currentPhase();
  anchor(phase);
  audio.setControls({ phase, playPose: state.playPose });
  if (!state.playing) audio.scratchRoll(before, dx, dy, radius, phase);
  requestDraw();
}
function roll(from, to) {
  const { added, orientation } = collectSweep(state.ribbons, from, to,
    state.orientation, PICKUP_REACH, state.grainMs, floorIds(),
    state.grainMode, state.grainSpreadMs);
  // Make all cuts before changing the ball; one failed source cannot half-commit a gesture.
  const copies = added.map(ribbon => ({
    ...ribbon, name: sources[ribbon.sourceIndex].name,
    ...cutRibbon(sources[ribbon.sourceIndex], ribbon.cell, ribbon.grainMs),
  }));
  state.position = { phase: clamp(to.phase, 0, 1), lane: clamp(to.lane, 0, 7) };
  state.orientation = orientation;
  if (copies.length) {
    state.ribbons = state.ribbons.concat(copies);
    updateBall();
    audio.auditionPickup(copies);
  } else audio.setRibbons(state.ribbons, state.orientation);
  updatePosition();
  return copies.length;
}
function restoreBall(snapshot) {
  state.ribbons = snapshot.ribbons;
  state.orientation = snapshot.orientation;
  if (snapshot.playPose) state.playPose = snapshot.playPose;
  state.position = { ...snapshot.position };
  state.active = null;
  updatePosition();
  updateBall();
}
function pickHere() {
  if (state.drag || state.busy || state.mode !== "record") return;
  const before = snapshotBall();
  try {
    const count = roll(state.position, state.position);
    if (count) state.history = before;
    updateBall();
    announce(count ? `Picked up ${count} ${count === 1 ? "grain" : "grains"}.`
      : floorRemaining(state.ribbons, floorIds())
        ? "Nothing fresh here · roll over another wave."
        : "Floor empty · lay another sound.");
    clearError();
  } catch (cause) { restoreBall(before); showError(cause); }
}
function endGesture(cancel = false) {
  const drag = state.drag;
  if (!drag) return;
  state.drag = null;
  canvas.classList.remove("is-rolling");
  if (canvas.hasPointerCapture(drag.id)) canvas.releasePointerCapture(drag.id);
  if (drag.kind === "roll") {
    if (cancel) {
      restoreBall(drag.before);
      state.history = drag.previousHistory;
      announce("Roll cancelled · ball restored.");
    } else {
      announce(`${state.ribbons.length - drag.before.ribbons.length} new grains · `
        + `${coveredSources(state.ribbons)} sources touched.`);
    }
    updateBall();
  } else {
    if (cancel) {
      anchor(drag.phase);
      state.playPose = drag.playPose;
      audio.setControls({ phase: state.phase, playPose: state.playPose });
    }
    if (drag.wasPlaying) setPlaying(true);
    else requestDraw();
  }
}
function setMode(mode) {
  if (mode === state.mode) return;
  if (state.drag) endGesture();
  if (mode === "play" && micSession && micSession.phase !== "processing") cancelMic();
  state.mode = mode;
  const recording = mode === "record";
  $("recordTab").setAttribute("aria-selected", String(recording));
  $("playTab").setAttribute("aria-selected", String(!recording));
  $("recordTab").tabIndex = recording ? 0 : -1;
  $("playTab").tabIndex = recording ? -1 : 0;
  $("recordControls").hidden = !recording;
  $("playControls").hidden = recording;
  $("phaseName").textContent = recording ? "RECORD" : "PLAY";
  $("canvasHelp").textContent = recording
    ? "Drag the marble across the waves. Tap Audio to hear pickups."
    : "Drag like a trackball; the straw stays still.";
  canvas.setAttribute("aria-label", recording
    ? "Eight straight audio waveforms. Drag in any direction to roll the marble and collect grain zones. Arrow keys roll; Enter picks up here."
    : "Collected marble with irregular grain zones. Drag or use arrow keys to roll in any direction beneath the fixed straw needle. Enter sounds only zones under the tip.");
  requestDraw();
  announce(recording ? "Roll over a wave to collect."
    : state.ribbons.length ? "Roll or tap Play to hear grain zones."
      : "Ball empty · roll in Record.");
}

const audio = new GlobuleAudio({
  onHit(ribbon, hit) {
    if (disposed) return;
    state.active = ribbon;
    $("nowReading").textContent = `${ribbon.name || sources[ribbon.sourceIndex].name} · `
      + `${Math.round((ribbon.cell + .5) / SLICE_CELLS * 100)}% of source`
      + (hit.reverse ? " · backwards" : "");
    requestDraw();
  },
  onError(cause) {
    if (disposed) return;
    const phase = currentPhase();
    state.audioOn = false;
    anchor(phase);
    showError(cause);
    updateAudioButton();
    updateTransport();
    announce("Playback stopped. The ball is intact; tap Audio to retry.");
    void audio.close();
  },
});
async function toggleAudio() {
  if (state.starting || disposed) return;
  if (state.audioOn) {
    const phase = currentPhase();
    state.audioOn = false;
    audio.setEnabled(false);
    anchor(phase);
    updateAudioButton();
    updateTransport();
    announce("Audio off · transport still moves.");
    return;
  }
  const attempt = ++audioAttempt;
  state.starting = true;
  clearError();
  updateAudioButton();
  try {
    // Only the Audio button may create/resume a context; Play and gestures never do.
    await audio.arm();
    if (disposed || attempt !== audioAttempt) return;
    const phase = currentPhase(); // Join the live, silent orbit, not the click-time phase.
    audio.setRibbons(state.ribbons, state.orientation, state.playPose);
    audio.setControls({
      phase, speed: state.speed, direction: state.direction, scatter: state.scatter,
      needleWidth: state.needleWidth, needle: state.needle, playPose: state.playPose,
    });
    audio.transport(state.playing, phase);
    audio.setLevel(state.level);
    state.audioOn = true;
    audio.setEnabled(true);
    if (!audio.enabled) throw new Error("The sample reader stopped. Tap Audio to retry.");
    anchor(phase);
    announce(state.ribbons.length ? "Audio on · pickups and straw are audible."
      : "Audio on · roll over the waves.");
  } catch (cause) {
    if (!disposed) {
      state.audioOn = false;
      showError(cause);
      announce("Audio did not start. The ball and silent transport remain usable.");
      await audio.close();
    }
  } finally {
    if (!disposed && attempt === audioAttempt) {
      state.starting = false;
      updateAudioButton();
      updateTransport();
      requestDraw();
    }
  }
}

function laySources(placements) {
  const staged = sources.slice();
  for (const { index, source } of placements) staged[index] = source;
  if (staged.reduce((sum, source) => sum + source.bytes, 0) > MAX_TOTAL_BYTES)
    throw new RangeError("Decoded floor audio exceeds 96 MiB total.");
  for (const { index, source } of placements)
    sources[index] = { ...source, floorId: nextFloorId++ };
  // A new floor placement is collectible again; the old grain copies remain
  // attached to the same ball, with their own PCM, size and identity.
  updateSource();
}
function stopMicTracks(stream) {
  stream?.getTracks().forEach(track => track.stop());
}
function releaseMicTracks(take) {
  const stream = take.stream;
  take.stream = null;
  stopMicTracks(stream);
}
function cancelMic(cause) {
  const take = micSession;
  if (!take) return;
  micSession = null;
  ++micAttempt; // A permission prompt can resolve after it was cancelled.
  clearTimeout(take.timeout);
  if (take.recorder && take.recorder.state !== "inactive") {
    try { take.recorder.stop(); } catch { /* already stopped by the device */ }
  }
  releaseMicTracks(take);
  state.busy = false;
  if (disposed) return;
  $("micStatus").textContent = cause ? "Mic off · take discarded." : "Mic off · recording cancelled.";
  if (cause) showError(cause);
  updateSource();
}
function finishMic(take) {
  if (micSession !== take || take.phase !== "recording") return;
  take.phase = "processing";
  clearTimeout(take.timeout);
  try {
    if (take.recorder.state !== "recording")
      throw new Error("The microphone stopped before the take was finished.");
    take.recorder.stop();
    releaseMicTracks(take);
    $("micStatus").textContent = "Mic off · decoding the take on this device…";
    updateSource();
  } catch (cause) { cancelMic(cause); }
}
async function startMic() {
  if (micSession?.phase === "permission") { cancelMic(); return; }
  if (micSession?.phase === "recording") { finishMic(micSession); return; }
  if (state.busy || disposed || state.mode !== "record") return;
  if (!navigator.mediaDevices?.getUserMedia || !globalThis.MediaRecorder) {
    showError(new Error("Microphone recording needs HTTPS or localhost and MediaRecorder support."));
    return;
  }
  const take = { index: state.sourceIndex, phase: "permission", attempt: ++micAttempt,
    recorder: null, stream: null, timeout: 0, chunks: [], bytes: 0 };
  micSession = take;
  state.busy = true;
  clearError();
  $("micStatus").textContent = "Waiting for microphone permission… Cancel here if you change your mind.";
  updateSource();
  let stream;
  try {
    // Permission is requested only by this button, never by Audio, Play or a roll.
    stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
    });
    if (disposed || document.hidden || micSession !== take || take.attempt !== micAttempt) {
      stopMicTracks(stream);
      if (micSession === take) cancelMic();
      return;
    }
    take.stream = stream;
    const recorder = new MediaRecorder(stream);
    take.recorder = recorder;
    for (const track of stream.getTracks()) track.addEventListener("ended", () => {
      if (micSession === take && take.phase === "recording")
        cancelMic(new Error("The microphone disconnected. The floor has not changed."));
    }, { once: true });
    recorder.addEventListener("dataavailable", ({ data }) => {
      if (micSession !== take || !data?.size) return;
      take.bytes += data.size;
      if (take.bytes > MAX_FILE_BYTES) {
        cancelMic(new RangeError("The mic take exceeded 12 MiB. The floor has not changed."));
        return;
      }
      take.chunks.push(data);
    });
    recorder.addEventListener("error", () => {
      if (micSession === take)
        cancelMic(new Error("The mic recorder stopped unexpectedly. The floor has not changed."));
    }, { once: true });
    recorder.addEventListener("stop", async () => {
      if (micSession !== take) return;
      if (take.phase !== "processing" || document.hidden) {
        cancelMic(new Error("The microphone disconnected before the take was finished."));
        return;
      }
      try {
        const blob = new Blob(take.chunks, { type: recorder.mimeType || "audio/webm" });
        const source = await decodeLocalSource(blob, take.index, sources, undefined,
          { name: `Mic take ${take.index + 1}`, kind: "mic" });
        if (micSession !== take || disposed || document.hidden) return;
        laySources([{ index: take.index, source }]);
        $("micStatus").textContent = `Mic off · take laid on ribbon ${take.index + 1}.`;
        announce("The mic take is on the floor. Roll over it to pick up its grains.");
        clearError();
      } catch (cause) {
        if (micSession === take && !disposed) {
          showError(cause);
          $("micStatus").textContent = "Mic off · take discarded; earlier sounds unchanged.";
        }
      } finally {
        if (micSession === take) {
          micSession = null;
          state.busy = false;
          if (!disposed) updateSource();
        }
      }
    }, { once: true });
    recorder.start(250);
    take.phase = "recording";
    take.timeout = setTimeout(() => finishMic(take), MAX_MIC_SECONDS * 1000);
    $("micStatus").textContent = `Recording ribbon ${take.index + 1} · finish here or auto-stop at 30 s. No mic monitoring.`;
    updateSource();
  } catch (cause) {
    // cancelMic owns an acquired stream; do not stop the same tracks twice if
    // construction/start failed after permission had already succeeded.
    if (micSession === take) {
      if (!take.stream) stopMicTracks(stream);
      cancelMic(cause);
    } else stopMicTracks(stream);
  }
}

for (let index = 0; index < SOURCE_COUNT; index++)
  $("sourceLane").append(new Option("", String(index)));
for (const [index, name] of SOURCE_NAMES.entries())
  $("sampleSelect").append(new Option(name, String(index)));
for (const [id, presets] of [["recordPreset", RECORD_PRESETS], ["playPreset", PLAY_PRESETS]]) {
  for (const preset of presets) $(id).append(new Option(preset.label, preset.id));
  const custom = new Option("Custom", "custom");
  custom.disabled = true;
  $(id).append(custom);
}
try { view = createGlobuleView(canvas); }
catch (cause) { showError(cause); announce("Canvas unavailable. The sliders and pickup button still work."); }
updatePosition();
updateAudioButton();
updateRecordControls();
updatePlayControls();
updateSource();
updateBall();
requestDraw();
if (globalThis.ResizeObserver) {
  resizeObserver = new ResizeObserver(requestDraw);
  resizeObserver.observe(canvas);
}
on(window, "resize", requestDraw);
on($("audioButton"), "click", toggleAudio);
on($("playButton"), "click", () => setPlaying(!state.playing));
on($("recordTab"), "click", () => setMode("record"));
on($("playTab"), "click", () => setMode("play"));
for (const tab of [$("recordTab"), $("playTab")]) on(tab, "keydown", event => {
  if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
  event.preventDefault();
  const next = event.key === "ArrowLeft" || event.key === "Home" ? "record" : "play";
  setMode(next);
  $(next === "record" ? "recordTab" : "playTab").focus();
});
function rollUnderTip(event, drag) {
  const rect = canvas.getBoundingClientRect();
  const dx = event.clientX - drag.x, dy = event.clientY - drag.y;
  movePlayBall(dx, dy, playRadius(rect.width, rect.height));
  drag.x = event.clientX;
  drag.y = event.clientY;
}
on(canvas, "pointerdown", event => {
  if (event.button !== 0 || state.drag || state.busy) return;
  const point = state.mode === "record" ? view?.pointFor(event) : null;
  if (state.mode === "record" && !point) return;
  canvas.focus({ preventScroll: true });
  if (state.mode === "record") {
    state.drag = { kind: "roll", id: event.pointerId, last: point,
      before: snapshotBall(), previousHistory: state.history };
    state.history = state.drag.before;
    try { roll(point, point); }
    catch (cause) { endGesture(true); showError(cause); return; }
  } else {
    const phase = currentPhase(), wasPlaying = state.playing;
    if (wasPlaying) setPlaying(false);
    state.drag = { kind: "scratch", id: event.pointerId, phase, playPose: state.playPose,
      x: event.clientX, y: event.clientY, wasPlaying };
    audio.scratch(phase, true);
  }
  canvas.setPointerCapture(event.pointerId);
  canvas.classList.add("is-rolling");
  updateBall();
});
on(canvas, "pointermove", event => {
  const drag = state.drag;
  if (!drag || drag.id !== event.pointerId) return;
  if (drag.kind === "roll") {
    const next = view.pointFor(event, true);
    try { roll(drag.last, next); drag.last = next; }
    catch (cause) { endGesture(true); showError(cause); }
  } else rollUnderTip(event, drag);
});
on(canvas, "pointerup", event => {
  if (state.drag?.id !== event.pointerId) return;
  if (state.drag.kind === "roll") {
    try {
      const next = view.pointFor(event, true);
      roll(state.drag.last, next);
    } catch (cause) { endGesture(true); showError(cause); return; }
  } else rollUnderTip(event, state.drag);
  endGesture();
});
on(canvas, "pointercancel", event => { if (state.drag?.id === event.pointerId) endGesture(true); });
on(canvas, "lostpointercapture", () => { if (state.drag) endGesture(true); });
on(canvas, "keydown", event => {
  if (state.busy || state.drag) return;
  if (event.key === "Enter") {
    event.preventDefault();
    if (state.mode === "record") pickHere();
    else audio.scratch(currentPhase(), true);
    return;
  }
  if (!["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)) return;
  event.preventDefault();
  if (state.mode === "record") {
    const amount = event.shiftKey ? .005 : 1 / SLICE_CELLS;
    const from = { ...state.position };
    const to = { phase: clamp(from.phase
      + (event.key === "ArrowRight" ? amount : event.key === "ArrowLeft" ? -amount : 0), 0, 1),
    lane: clamp(from.lane + (event.key === "ArrowDown" ? .25 : event.key === "ArrowUp" ? -.25 : 0), 0, 7) };
    if (from.phase === to.phase && from.lane === to.lane) return;
    const before = snapshotBall();
    try {
      roll(from, to);
      state.history = before;
      updateBall();
    } catch (cause) { restoreBall(before); showError(cause); }
  } else {
    const rect = canvas.getBoundingClientRect();
    const radius = playRadius(rect.width, rect.height);
    const amount = radius * (event.shiftKey ? .035 : .16);
    movePlayBall((event.key === "ArrowRight" ? 1 : event.key === "ArrowLeft" ? -1 : 0) * amount,
      (event.key === "ArrowDown" ? 1 : event.key === "ArrowUp" ? -1 : 0) * amount, radius);
  }
});
on($("mapPhase"), "input", event => {
  if (state.busy || state.drag) return;
  state.position.phase = clamp(+event.target.value, 0, 1);
  updatePosition();
});
on($("mapLane"), "input", event => {
  if (state.busy || state.drag) return;
  state.position.lane = clamp(+event.target.value, 0, 7);
  updatePosition();
});
on($("grainSize"), "input", event => {
  if (state.busy) return;
  state.grainMs = Math.round(clamp(+event.target.value, MIN_GRAIN_MS, MAX_GRAIN_MS));
  updateRecordControls();
});
on($("grainMode"), "change", event => {
  if (state.busy) return;
  state.grainMode = event.target.value === "random" ? "random" : "fixed";
  updateRecordControls();
});
on($("grainSpread"), "input", event => {
  if (state.busy) return;
  state.grainSpreadMs = Math.round(clamp(+event.target.value, 0, 100));
  updateRecordControls();
});
on($("recordPreset"), "change", event => {
  if (state.busy || state.drag) return;
  const preset = RECORD_PRESETS.find(candidate => candidate.id === event.target.value);
  if (!preset) return;
  Object.assign(state, {
    grainMs: preset.grainMs, grainMode: preset.grainMode, grainSpreadMs: preset.grainSpreadMs,
  });
  updateRecordControls();
  announce(`${preset.label} · next pickups use this grain size.`);
});
on($("pickButton"), "click", pickHere);
on($("undoButton"), "click", () => {
  if (!state.history || state.drag || state.busy) return;
  const before = state.history;
  state.history = null;
  restoreBall(before);
  if (before.playPose) audio.setControls({ phase: currentPhase(), playPose: state.playPose });
  if (before.phase !== undefined) setPhase(before.phase, true);
  announce("Undid the last roll or Clear Ball. The sound copies returned with the ball.");
});
on($("resetButton"), "click", () => {
  if (state.drag || state.busy) return;
  state.history = { ...snapshotBall(), playPose: state.playPose, phase: currentPhase() };
  state.ribbons = [];
  state.orientation = IDENTITY_ORIENTATION;
  state.playPose = IDENTITY_ORIENTATION;
  state.position = { phase: .15, lane: 3.5 };
  state.active = null;
  updatePosition();
  updateBall();
  audio.setControls({ phase: currentPhase(), playPose: state.playPose });
  setPhase(0, true);
  announce("Ball cleared. Source loops stay ready. Undo can bring the captured scraps back.");
});
on($("sourceLane"), "change", event => {
  state.sourceIndex = Math.round(clamp(+event.target.value, 0, SOURCE_COUNT - 1));
  updateSource();
});
on($("useSampleButton"), "click", () => {
  if (state.busy) return;
  try {
    const source = sampleSource(Number($("sampleSelect").value));
    laySources([{ index: state.sourceIndex, source }]);
    clearError();
    announce(`“${source.name}” is now on ribbon ${state.sourceIndex + 1}. The ball kept its earlier grains.`);
  } catch (cause) { showError(cause); }
});
on($("micButton"), "click", () => void startMic());
on($("importButton"), "click", () => { if (!state.busy) $("sourceInput").click(); });
on($("sourceInput"), "change", async event => {
  const files = Array.from(event.target.files ?? []);
  event.target.value = "";
  if (!files.length || state.busy) return;
  const index = state.sourceIndex, attempt = ++importAttempt;
  state.busy = true;
  clearError();
  updateSource();
  announce(`Decoding ${files.length} local ${files.length === 1 ? "file" : "files"} offline. The ball will not change.`);
  try {
    const placements = await decodeLocalSources(files, index, sources);
    if (disposed || document.hidden || attempt !== importAttempt) return;
    laySources(placements);
    announce(`${placements.length} ${placements.length === 1 ? "file is" : "files are"} on the floor. Earlier grains are still on the ball.`);
  } catch (cause) {
    if (!disposed && attempt === importAttempt && !document.hidden) {
      showError(cause);
      announce("No floor source was replaced. Try smaller mono or stereo audio files.");
    }
  } finally {
    state.busy = false;
    if (!disposed) updateSource();
  }
});
for (const [id, key] of [["spinSpeed", "speed"], ["scatter", "scatter"],
  ["needleWidth", "needleWidth"], ["needle", "needle"]]) on($(id), "input", event => {
  updateReader({ [key]: +event.target.value });
});
on($("directionButton"), "click", () => updateReader({ direction: -state.direction }));
on($("playPreset"), "change", event => {
  const preset = PLAY_PRESETS.find(candidate => candidate.id === event.target.value);
  if (!preset) return;
  updateReader({ speed: preset.speed, direction: preset.direction,
    scatter: preset.scatter, needleWidth: preset.needleWidth, needle: preset.needle });
  announce(`${preset.label} · the ball keeps turning where it is.`);
});
on($("homeButton"), "click", () => {
  setPhase(0, true);
  announce("Back to the beginning of this roll. The same zones will be touched again.");
});
on($("output"), "input", event => {
  state.level = clamp(+event.target.value, 0, .8);
  audio.setLevel(state.level);
  updatePlayControls();
});
on(window, "blur", () => { if (state.drag) endGesture(true); });
on(document, "visibilitychange", () => {
  if (document.hidden) {
    if (state.drag) endGesture(true);
    cancelMic();
    ++importAttempt;
    if (state.starting) {
      ++audioAttempt;
      state.starting = false;
      void audio.close();
    }
    const phase = currentPhase();
    state.audioOn = false;
    audio.setEnabled(false);
    anchor(phase);
    cancelAnimationFrame(raf);
    raf = 0;
    updateAudioButton();
    updateTransport();
  } else {
    anchor(state.phase);
    requestDraw();
    announce("Ball ready. Tap Audio again if you want to hear it.");
  }
});
on(window, "pagehide", event => {
  ++audioAttempt;
  ++importAttempt;
  cancelMic();
  if (state.drag) endGesture(true);
  const phase = currentPhase();
  state.audioOn = false;
  anchor(phase);
  audio.setEnabled(false);
  cancelAnimationFrame(raf);
  raf = 0;
  void audio.close();
  if (event.persisted) {
    state.starting = false;
    updateAudioButton();
    return;
  }
  disposed = true;
  resizeObserver?.disconnect();
  abort.abort();
});
on(window, "pageshow", event => {
  if (!event.persisted || disposed) return;
  anchor(state.phase);
  updateAudioButton();
  updateTransport();
  requestDraw();
});

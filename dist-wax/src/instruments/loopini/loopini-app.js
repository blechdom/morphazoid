import { Loopini, clamp } from "./loopini.js";
import { LoopiniAudio } from "./loopini-audio.js";
import { createAudioStrip } from "../../ui/patterns/audio-strip.js";

const $ = (id) => document.getElementById(id);
const abort = new AbortController();
const on = (node, event, handler, options = {}) => node.addEventListener(event, handler, { ...options, signal: abort.signal });
let state = new Loopini().snapshot(), starting = false, disposed = false, audioAttempt = 0;
let pending = null, pendingMode = "replace", recordAttempt = 0, session = null;
let speedValue = 1, speedDrag = null;
let noticeKey = "", demoAfterArm = false;
const colors = ["#ffaf8e", "#8cdac7", "#c2b1f1", "#f1ce7e", "#88c9ef", "#f0accc"];
const audio = new LoopiniAudio(receive, showError);
const strip = createAudioStrip({ buttonId: "audioButton", levelId: "level", level: 0.48, min: 0, max: 0.8, step: 0.01,
  onAudioClick: toggleAudio, onLevelInput: (value) => audio.setLevel(value) });
$("audioSlot").replaceWith(strip);
const pads = colors.map((color, id) => {
  const slot = document.createElement("div"); slot.className = "loopini-slot"; slot.style.setProperty("--loop-color", color);
  slot.innerHTML = `<div class="loopini-disc"><button id="loop${id}" class="loopini-pad is-empty" type="button" aria-label="Record loop ${id + 1}">
    <svg viewBox="0 0 100 100" aria-hidden="true"><circle class="loopini-ring" cx="50" cy="50" r="46"/>
    <circle class="loopini-progress" cx="50" cy="50" r="46" pathLength="1" stroke-dasharray="0 1"/>
    <path class="loopini-wave"/></svg>
    <span class="loopini-face"><span class="loopini-number">${id + 1}</span><span class="loopini-symbol">●</span><span class="loopini-label">Record</span><span class="loopini-small">tap + make a sound</span></span>
    </button><div class="loopini-slot-tools" role="group" aria-label="Recording controls for loop ${id + 1}" hidden>
      <button id="again${id}" class="loopini-record-icon" type="button" aria-label="Replace recording in loop ${id + 1}" title="Record a new take — replaces this loop">
        <svg viewBox="0 0 24 24" aria-hidden="true"><circle class="loopini-action-glyph" cx="12" cy="12" r="6"/><rect class="loopini-stop-glyph" x="6" y="6" width="12" height="12" rx="1"/><path class="loopini-cancel-glyph" d="m7 7 10 10M17 7 7 17"/></svg>
      </button>
      <button id="add${id}" class="loopini-add" type="button" aria-label="Add a layer to loop ${id + 1}" title="Add a layer — keep the old sound">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path class="loopini-action-glyph" d="M12 5v14M5 12h14"/><rect class="loopini-stop-glyph" x="6" y="6" width="12" height="12" rx="1"/><path class="loopini-cancel-glyph" d="m7 7 10 10M17 7 7 17"/></svg>
      </button>
      <button id="remove${id}" type="button" aria-label="Clear loop ${id + 1}" title="Clear this loop — Undo can restore it"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m7 7 10 10M17 7 7 17"/></svg></button>
    </div></div>`;
  $("pads").append(slot);
  on($(`loop${id}`), "click", () => {
    if (pending === id || session?.id === id && !session.seen || state.recording?.id === id || !state.slots[id].filled) void record(id);
    else audio.send({ type: "toggle", id });
  });
  on($(`add${id}`), "click", () => void record(id, "add"));
  on($(`again${id}`), "click", () => void record(id, "replace"));
  on($(`remove${id}`), "click", () => audio.send({ type: "remove", id }));
  return { root: slot, button: $(`loop${id}`), tools: slot.querySelector(".loopini-slot-tools"),
    symbol: slot.querySelector(".loopini-symbol"), label: slot.querySelector(".loopini-label"),
    small: slot.querySelector(".loopini-small"), progress: slot.querySelector(".loopini-progress"),
    wave: slot.querySelector(".loopini-wave"), waveKey: null };
});

function say(title, message) {
  $("nextStep").textContent = title; $("nextStep").hidden = !title;
  $("liveStatus").textContent = message;
}
function showError(error) {
  $("audioError").hidden = false;
  const permission = ["NotAllowedError", "SecurityError"].includes(error?.name);
  const message = permission ? "The microphone wasn't allowed. Ask a grown-up to allow it in the browser, or tap Try a demo."
    : error?.name === "NotFoundError" ? "No microphone found. Connect one, or tap Try a demo." : error?.message ?? String(error);
  $("audioError").textContent = message;
  if (!audio.stream && session) { session = null; pending = null; recordAttempt++; }
  say("Let's try again.", message); render();
}
function requireAudio() {
  if (audio.armed && !starting) return true;
  say("First, turn the sound on.", "Audio is off — turn it on to hear playback");
  $("audioButton").focus({ preventScroll: false });
  return false;
}
async function toggleAudio() {
  $("audioError").hidden = true;
  const attempt = ++audioAttempt;
  if (audio.armed || starting) {
    starting = false; demoAfterArm = false; cancelTake(); audio.mute(); strip.setAudioState("off");
    say("Sound is off.", "Your loops are still here. Tap the speaker to hear them again."); render(); return;
  }
  starting = true; strip.setAudioState("starting"); render();
  try {
    const armed = await audio.arm();
    if (disposed || attempt !== audioAttempt) return;
    starting = false; strip.setAudioState(armed ? "on" : "off");
    if (armed) {
      audio.send({ type: "speed", value: speedValue });
      say(state.slots.some((s) => s.filled) ? "Your sounds are ready." : "Pick a circle. Make a sound.",
        state.slots.some((s) => s.filled) ? "Play your loops, or tap an empty circle to add a sound." : "Tap Record. Sing, clap or make a silly noise. Tap again to finish.");
      if (demoAfterArm) { demoAfterArm = false; audio.send({ type: "demo" }); audio.send({ type: "play", value: true }); }
    }
  } catch (error) { if (attempt === audioAttempt) { starting = false; strip.setAudioState("off"); showError(error); } }
  render();
}
function cancelTake() {
  recordAttempt++; pending = null; session = null; audio.send({ type: "cancel" }); audio.stopMic();
}
async function record(id, mode = "replace") {
  $("audioError").hidden = true;
  if (pending === id || session?.id === id && !session.seen) {
    cancelTake(); say("No rush.", "Tap any empty circle when you're ready."); render(); return;
  }
  if (state.recording?.id === id) {
    audio.send({ type: state.recording.waiting ? "cancel" : "finish" }); return;
  }
  if (pending !== null || state.recording || !requireAudio()) return;
  if (speedDrag) endSpeedDrag({ pointerId: speedDrag.id });
  const attempt = ++recordAttempt; pending = id; pendingMode = mode;
  say(mode === "add" ? "Let's add a layer." : state.slots[id].filled ? "Let's replace that take." : "Let's use the microphone.",
    "Allow the microphone when your browser asks. Tap the same icon or circle to cancel."); render();
  try {
    const allowed = await audio.startMic();
    if (!allowed || disposed || attempt !== recordAttempt) return;
    session = { id, mode, replacing: mode === "replace" && state.slots[id].filled, seen: false }; pending = null;
    audio.send({ type: "record", id, mode });
  } catch (error) {
    if (attempt === recordAttempt && !disposed) { pending = null; showError(error); }
  } finally { if (attempt === recordAttempt) { pending = null; render(); } }
}
function receive(next) {
  const replaced = Boolean(session?.seen && session.replacing && !next.recording && next.notice === "recorded");
  state = next;
  if (session && next.recording?.id === session.id) session.seen = true;
  else if (session?.seen && !next.recording) { session = null; audio.stopMic(); }
  const key = `${state.notice}:${state.revision}:${state.recording?.waiting > 0}:${state.playing}`;
  if (key !== noticeKey && pending === null) { noticeKey = key; announce(); }
  if (replaced) say("New take recorded.", "That loop now plays only your new take. Undo brings the old one back.");
  render();
}
function announce() {
  if (state.recording) {
    const replacing = state.recording.mode === "replace" && state.slots[state.recording.id].filled;
    say(state.recording.waiting > 0 ? "Get ready…" : state.recording.mode === "add" ? "Adding your new sound!" : replacing ? "Recording a replacement." : "Recording. Your turn!",
      state.recording.waiting > 0 ? "Start when the circle says Recording. One turn, then it stops by itself."
        : state.recording.mode === "add" ? "Your old sound keeps playing. Add a new sound for one turn; it stops for you."
          : replacing ? "This new take replaces the old one. It stops after one turn; tap ■ to finish early."
            : state.length ? "Keep going! It will finish for you. Tap the circle to finish early." : "Make your sound. Tap this circle again to loop it.");
    return;
  }
  const text = {
    empty: ["Pick a circle. Make a sound.", "Tap Record. Sing, clap or make a silly noise. Tap again to finish."],
    recorded: ["You made a loop!", "● records a replacement. + adds a layer. Tap the circle off or on."],
    added: ["Another sound in your loop!", "Tap the circle off or on. Undo brings back the previous version."],
    cancelled: ["Your other sounds are safe.", "That take was cancelled. Tap an empty circle to try again."],
    quiet: ["I couldn't hear that one.", "Try a little closer to the microphone. Your previous sounds are still here."],
    removed: ["One sound removed.", "Oops? Undo brings it back."],
    undone: ["Brought it back!", "Your last recording or change has been undone."],
    mix: ["Mix your sounds.", "Tap a circle to turn it off or on. Your other loops keep going."],
    playing: ["Your loops are playing.", "Tap circles off or on. ● replaces a take; + adds a layer."],
    paused: ["", ""],
    demo: ["A few sounds to play with.", "Tap circles to turn sounds off or on. Turn Speed for slower or faster sounds."],
  }[state.notice];
  if (!audio.armed) { say("Sound is off.", "Audio is off — turn it on to hear playback"); return; }
  if (text) say(...text);
}
function render() {
  const busy = pending !== null || Boolean(state.recording) || Boolean(session && !session.seen);
  const count = state.slots.filter((s) => s.filled).length;
  $("playButton").setAttribute("aria-pressed", String(state.playing));
  $("playButton").innerHTML = state.playing ? '<span aria-hidden="true">Ⅱ</span> Pause' : '<span aria-hidden="true">▶</span> Play loops';
  $("undoButton").disabled = busy || !state.canUndo;
  $("demoButton").hidden = count > 0; $("demoButton").disabled = busy || starting;
  $("speed").disabled = $("normalSpeed").disabled = busy;
  $("speedControl").classList.toggle("is-locked", busy);
  $("speed").value = speedValue;
  $("speed").setAttribute("aria-valuetext", `${speedValue.toFixed(2)} times normal speed`);
  $("speedOut").value = `${speedValue.toFixed(2)}×`;
  $("speedControl").style.setProperty("--knob-angle", `${Math.log2(speedValue) * 135}deg`);
  $("speedHelp").textContent = busy ? "Speed stays fixed for this take." : "Slower + lower ↔ faster + higher";
  $("micStatus").textContent = pending !== null ? "Mic permission…" : audio.stream ? "● Mic on" : "Mic off";
  $("micStatus").classList.toggle("is-live", Boolean(audio.stream));
  for (let id = 0; id < pads.length; id++) {
    const p = pads[id], s = state.slots[id], r = state.recording?.id === id ? state.recording : null;
    const asking = pending === id || session?.id === id && !session.seen;
    p.button.disabled = busy && !r && !asking;
    p.button.className = `loopini-pad ${s.filled ? "is-filled" : "is-empty"}${s.audible ? " is-on" : ""}${r ? r.waiting ? " is-waiting" : " is-recording" : ""}`;
    p.button.setAttribute("aria-label", asking ? `Cancel microphone request for loop ${id + 1}` : r ? `${r.waiting ? "Cancel" : "Finish"} recording loop ${id + 1}` : !s.filled ? `Record loop ${id + 1}` : `Turn loop ${id + 1} ${s.on ? "off" : "on"}`);
    p.button.title = p.button.getAttribute("aria-label");
    if (s.filled && !r && !asking) p.button.setAttribute("aria-pressed", String(s.on));
    else p.button.removeAttribute("aria-pressed");
    p.symbol.textContent = asking ? "…" : r ? r.waiting ? Math.ceil(r.waiting) : "■" : s.filled ? s.on ? "♪" : "Ⅱ" : "●";
    p.label.textContent = asking ? "Allow mic" : r ? r.waiting ? "Get ready" : r.mode === "add" ? "Adding sound" : "Recording" : s.filled ? s.audible ? "Playing" : s.on ? "Ready" : "Off" : "Record";
    p.small.textContent = asking ? "tap to cancel" : r ? r.waiting ? "start in a moment" : state.length ? "finishes for you" : `${r.seconds.toFixed(1)}s · tap to finish` : s.filled ? `tap to turn ${s.on ? "off" : "on"}` : "tap + make a sound";
    const progress = r ? r.waiting ? state.phase : r.progress : state.phase;
    p.progress.setAttribute("stroke-dasharray", `${Math.max(0.001, Math.min(1, progress))} 1`);
    p.tools.hidden = !s.filled;
    const activeMode = r?.mode ?? (pending === id ? pendingMode : session?.id === id ? session.mode : null);
    for (const [buttonId, mode] of [[`again${id}`, "replace"], [`add${id}`, "add"]]) {
      const button = $(buttonId), active = Boolean((asking || r) && activeMode === mode);
      const cancelling = active && (asking || r?.waiting > 0);
      button.disabled = busy && !active;
      button.classList.toggle("is-stopping", active && !cancelling);
      button.classList.toggle("is-cancelling", Boolean(cancelling));
      button.setAttribute("aria-pressed", String(active));
      button.setAttribute("aria-label", active ? `${cancelling ? "Cancel" : "Finish"} ${mode === "add" ? "layer" : "replacement"} recording in loop ${id + 1}`
        : mode === "add" ? `Add a layer to loop ${id + 1}` : `Replace recording in loop ${id + 1}`);
      button.title = active ? button.getAttribute("aria-label")
        : mode === "add" ? "Add a layer — keep the old sound" : "Record a new take — replaces this loop";
    }
    $(`remove${id}`).disabled = busy;
    const waveKey = `${state.revision}:${s.filled}`;
    if (p.waveKey !== waveKey) {
      p.waveKey = waveKey;
      p.wave.setAttribute("d", s.waveform.map((a, i) => {
        const angle = i / 48 * Math.PI * 2 - Math.PI / 2, radius = 39 + Math.min(1, a) * 5;
        return `${i ? "L" : "M"}${50 + Math.cos(angle) * radius} ${50 + Math.sin(angle) * radius}`;
      }).join("") + (s.filled ? "Z" : ""));
    }
  }
  $("loopini").dataset.state = JSON.stringify({ ...state, audio: audio.armed, mic: Boolean(audio.stream), pending });
}

function setSpeed(value) {
  if (pending !== null || state.recording || session && !session.seen) { render(); return; }
  speedValue = Math.round(clamp(value, 0.5, 2, 1) * 100) / 100;
  if (audio.node) audio.send({ type: "speed", value: speedValue });
  else state = { ...state, speed: speedValue, currentSpeed: speedValue };
  render();
}
on($("speed"), "input", () => setSpeed(Number($("speed").value)));
on($("normalSpeed"), "click", () => setSpeed(1));
on($("speed"), "pointerdown", (event) => {
  if (event.button !== 0 || event.isPrimary === false || event.currentTarget.disabled || speedDrag) return;
  event.currentTarget.focus({ preventScroll: true });
  speedDrag = { id: event.pointerId, x: event.clientX, y: event.clientY, value: speedValue };
  event.currentTarget.setPointerCapture(event.pointerId); event.preventDefault();
});
on($("speed"), "pointermove", (event) => {
  if (!speedDrag || speedDrag.id !== event.pointerId) return;
  const travel = (event.clientX - speedDrag.x - event.clientY + speedDrag.y) / 110;
  const value = speedDrag.value * 2 ** travel;
  setSpeed(Math.abs(value - 1) < 0.02 ? 1 : value); event.preventDefault();
});
function endSpeedDrag(event, cancel = false) {
  if (!speedDrag || speedDrag.id !== event.pointerId) return;
  const saved = speedDrag; speedDrag = null;
  if (cancel) setSpeed(saved.value);
  if ($("speed").hasPointerCapture(event.pointerId)) $("speed").releasePointerCapture(event.pointerId);
}
on($("speed"), "pointerup", (event) => endSpeedDrag(event));
on($("speed"), "pointercancel", (event) => endSpeedDrag(event, true));
on($("speed"), "lostpointercapture", (event) => endSpeedDrag(event, true));

on($("playButton"), "click", () => {
  if (audio.node && (state.recording || pending !== null || session)) {
    cancelTake(); audio.send({ type: "play", value: !state.playing }); return;
  }
  if (!audio.node || !state.length) { requireAudio(); if (audio.armed) say("Make a sound first.", "Tap a circle to record, or Try a demo."); return; }
  cancelTake(); audio.send({ type: "play", value: !state.playing });
});
on($("demoButton"), "click", () => {
  $("audioError").hidden = true;
  if (!requireAudio()) { demoAfterArm = true; return; }
  audio.send({ type: "demo" }); audio.send({ type: "play", value: true });
});
on($("undoButton"), "click", () => audio.send({ type: "undo" }));
on($("resetButton"), "click", () => {
  if (!state.slots.some((s) => s.filled) && !state.recording && pending === null) return;
  $("resetDialog").returnValue = "";
  $("resetDialog").showModal();
});
on($("resetDialog"), "close", () => {
  if ($("resetDialog").returnValue === "reset") {
    cancelTake(); speedValue = 1; audio.send({ type: "reset" }); demoAfterArm = false; $("audioError").hidden = true;
  }
  $("resetButton").focus({ preventScroll: true });
});
on(document, "keydown", (event) => {
  if (event.ctrlKey || event.metaKey || event.altKey || event.repeat || document.querySelector("dialog[open]") ||
      event.target.closest("input,select,textarea,button,a,[contenteditable]") || state.recording || pending !== null) return;
  const id = Number(event.key) - 1;
  if (/^[1-6]$/.test(event.key) && state.slots[id]?.filled) { audio.send({ type: "toggle", id }); event.preventDefault(); }
});
on(window, "morphazoid:midi-input", (event) => {
  const m = event.detail?.message ?? event.detail;
  if (m?.type === "noteOn") {
    event.preventDefault(); // Never let an external key request microphone access.
    if (!document.hidden && !state.recording && pending === null) {
      const id = ((Math.round(m.note) % 6) + 6) % 6;
      if (state.slots[id]?.filled) audio.send({ type: "toggle", id });
    }
  }
});
function hide() {
  if (speedDrag) endSpeedDrag({ pointerId: speedDrag.id }, true);
  audioAttempt++; starting = false; cancelTake(); void audio.suspend(); strip.setAudioState("off");
  state = { ...state, playing: false, recording: null };
  say("Your sounds are still here.", "Tap Audio, then Play loops to continue."); render();
}
on(document, "visibilitychange", () => { if (document.hidden) hide(); });
on(window, "pagehide", (event) => {
  hide();
  if (event.persisted) return;
  disposed = true; strip.destroy(); abort.abort(); void audio.close();
});
render();

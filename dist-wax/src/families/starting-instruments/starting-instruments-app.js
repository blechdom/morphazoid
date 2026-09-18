import { STARTING_INSTRUMENTS } from "../../starting-instruments/catalog.js";
import { INSTRUMENT_HELP, formatParameter } from "../../starting-instruments/help.js";
import { CORES } from "../../starting-instruments/cores.js";
import { StartingAudio } from "../../starting-instruments/audio.js";
import { COLORS, renderInstrument, WORLD, polar, angleAt, tapeCenters, soupCenters, habitNodes } from "../../starting-instruments/render.js";
import { clamp } from "../../starting-instruments/common.js";
import { createAudioStrip } from "../../ui/patterns/audio-strip.js";

const id = document.body.dataset.startingInstrument;
const spec = STARTING_INSTRUMENTS[id];
const help = INSTRUMENT_HELP[id];
if (!spec) throw new Error("Unknown starting instrument page");
const $ = (name) => document.getElementById(name);
const canvas = $("stage"), context = canvas.getContext("2d", { alpha: false });
const mirror = new CORES[id](24000);
let state = mirror.snapshot(), selected = 0, brush = false, disposed = false, starting = false;
let params = { ...spec.defaults }, playing = false, pointer = null, renderId = 0, previousTime = performance.now();
let micPending = false, filePending = false, recordPending = false, lastUi = 0;
let audioAttempt = 0;
let micAttempt = 0, recordAttempt = 0;
let transform = { scale: 1, x: 0, y: 0, width: 1, height: 1 };
const abort = new AbortController();
const on = (node, event, fn) => node?.addEventListener(event, fn, { signal: abort.signal });
const status = (message) => { $("liveStatus").textContent = message; };
function error(e) {
  $("audioError").hidden = false;
  $("audioError").textContent = e instanceof Error ? e.message : String(e);
  starting = false;
  audioStrip.setAudioState(audio.armed ? "on" : "off");
  updateTools();
}
const audio = new StartingAudio(id, (next) => {
  const finished = state.recording && !next.recording;
  state = next;
  if (finished && id === "tape-worm") {
    audio.stopMic();
    status(next.lastRecording?.accepted
      ? `Tape ${next.lastRecording.index === 0 ? "A" : "B"} recorded: ${next.lastRecording.seconds.toFixed(2)} s. Press Play to hear it.`
      : "Recording was too short. The previous tape has been kept.");
  }
}, error);
const audioStrip = createAudioStrip({
  buttonId: "audioButton", levelId: "level", level: 0.48, min: 0, max: 0.72, step: 0.01,
  onAudioClick: () => toggleAudio(), onLevelInput: (value) => audio.setLevel(value),
});
$("audioSlot").replaceWith(audioStrip);

function snapshot() {
  return { ...state, params: { ...params }, playing,
    ...(id === "loop-soup" ? { tapeData: mirror.buffers } : {}) };
}
function send(message) {
  if (disposed) return;
  if (audio.node) audio.send(message);
  else { mirror.command(message); state = mirror.snapshot(); }
}
function setParams(values) {
  mirror.set(values); params = { ...mirror.params };
  send({ type: "params", values: params });
  if (typeof preset !== "undefined") {
    const match = Object.entries(spec.presets).find(([, p]) => Object.keys(p).every((k) => Math.abs(p[k] - params[k]) < 1e-8));
    preset.value = match?.[0] ?? "";
    $("presetHint").textContent = match ? help.presets[match[0]] : "Custom settings · current transport and stored material retained.";
  }
  syncControls();
}
async function toggleAudio() {
  const attempt = ++audioAttempt;
  $("audioError").hidden = true;
  if (starting || audio.armed) {
    audio.mute(); starting = false; recordPending = false;
    micPending = false; micAttempt++; recordAttempt++;
    audioStrip.setAudioState("off");
    status(playing ? "Audio is off — turn it on to hear playback" : "Audio off.");
    updateTools(); return;
  }
  starting = true; audioStrip.setAudioState("starting");
  try {
    const ok = await audio.arm(snapshot);
    if (disposed || attempt !== audioAttempt) return;
    starting = false; audioStrip.setAudioState(ok ? "on" : "off");
    if (ok) status(playing ? "Playing." : "Audio on. Press Play or use the stage.");
  } catch (e) { if (attempt === audioAttempt && !disposed) error(e); }
  updateTools();
}

function syncControls() {
  for (const c of spec.controls) {
    const input = $(c.key), out = $(`${c.key}Out`);
    input.value = params[c.key];
    out.value = formatParameter(id, c, params[c.key]);
  }
  $("playButton").setAttribute("aria-pressed", String(playing));
  $("playButton").textContent = playing ? "Pause" : "Play";
}
function button(label, action, parent = $("instrumentTools")) {
  const el = document.createElement("button"); el.type = "button"; el.textContent = label; el.className = "mini-action";
  on(el, "click", action); parent.append(el); return el;
}
function choose(count, label = "Voice", names = null) {
  const parent = $("selectors");
  for (let i = 0; i < count; i++) {
    const el = button(names?.[i] ?? `${label} ${i + 1}`, () => { selected = i; updateTools(); }, parent);
    el.dataset.select = i; el.style.setProperty("--voice", COLORS[i]);
  }
}
const preset = $("preset");
const customPreset = new Option("Custom settings", ""); customPreset.disabled = true; preset.add(customPreset);
for (const name of Object.keys(spec.presets)) { const option = new Option(name, name); preset.add(option); }
preset.value = Object.keys(spec.presets)[0];
on(preset, "change", () => { setParams(spec.presets[preset.value]); status("Preset changed; transport and stored material retained."); });
on($("playButton"), "click", () => {
  playing = !playing; send({ type: "play", value: playing }); syncControls();
  status(!audio.armed && playing ? "Audio is off — turn it on to hear playback" : playing ? "Playing." : "Paused.");
});
on($("resetButton"), "click", () => {
  send({ type: "reset" }); setParams(spec.defaults); preset.selectedIndex = 0;
  preset.value = Object.keys(spec.presets)[0]; brush = false;
  status(help.reset);
});
for (const c of spec.controls) on($(c.key), "input", () => {
  setParams({ [c.key]: Number($(c.key).value) });
});

let modeButton, extraButton, micButton, recordButton, brushButton, sourceSelect;
function activate(index = selected) {
  selected = index;
  if (id === "tempo-tantrum") send({ type: "nudge", index, amount: 0.22 });
  if (id === "tape-worm") send({ type: "jump", index, phase: 0 });
  if (id === "loop-soup") send({ type: "mode", index, value: state.modes?.[index] === "hold" ? "overdub" : "hold" });
  if (id === "habit-habitat") send({ type: "visit", index });
  if (id === "hollowphonic") send({ type: "strike", index });
  if (!audio.armed) status("Audio is off — turn it on to hear playback");
  updateTools();
}
async function toggleMic() {
  const attempt = ++micAttempt;
  if (micPending || audio.stream) {
    micPending = false; recordPending = false; audio.send({ type: "finish-record" }); audio.stopMic(); updateTools(); return;
  }
  micPending = true; updateTools();
  try {
    const ok = await audio.startMic();
    if (ok) {
      if (id === "loop-soup") setParams({ demo: 0 });
      if (id === "hollowphonic") { setParams({ source: 3 }); sourceSelect.value = "3"; }
      status("Microphone on. Use headphones before enabling Monitor.");
    }
  } catch (e) { if (attempt === micAttempt && !disposed) error(e); }
  if (attempt === micAttempt) micPending = false;
  updateTools();
}
function addMic() {
  micButton = button("Enable microphone", toggleMic);
  const label = document.createElement("label"); label.className = "check-control";
  const input = document.createElement("input"); input.type = "checkbox"; input.id = "monitor";
  label.append(input, document.createTextNode("Monitor live input · headphones"));
  $("instrumentTools").append(label);
  on(input, "change", () => audio.setMonitor(input.checked));
}

if (id === "tempo-tantrum") {
  choose(3, "Body");
  button("Nudge selected body", () => activate());
  button("Let go of the drive", () => { setParams({ strength: 0 }); status("Drive coupling released; the phases run at their own rates."); });
} else if (id === "tape-worm") {
  choose(2, "Tape", ["Tape A", "Tape B"]);
  modeButton = button("Splices on", () => setParams({ splice: params.splice > 0.5 ? 0 : 1 }));
  button("Reader to start", () => activate());
  const fileLabel = document.createElement("label"); fileLabel.className = "file-control"; fileLabel.textContent = "Replace selected tape · audio file";
  const input = document.createElement("input"); input.type = "file"; input.accept = "audio/*"; input.id = "tapeFile"; fileLabel.append(input); $("instrumentTools").append(fileLabel);
  on(input, "change", async () => {
    const file = input.files?.[0]; if (!file || filePending) return;
    if (!window.confirm(`Replace tape ${selected + 1}? The existing recording will be discarded.`)) { input.value = ""; return; }
    const index = selected; filePending = true; updateTools();
    try { const result = await audio.loadFile(file, index); if (result) status(result); } catch (e) { error(e); }
    input.value = ""; filePending = false; updateTools();
  });
  recordButton = button("Record selected tape", async () => {
    const attempt = ++recordAttempt;
    if (recordPending || state.recording) {
      recordPending = false; audio.send({ type: "finish-record" }); audio.stopMic(); updateTools(); return;
    }
    if (!audio.armed) { error("Turn Audio on before recording."); return; }
    if (!window.confirm(`Record over tape ${selected + 1}? A recording shorter than 0.08 s will keep the old tape.`)) return;
    const index = selected;
    recordPending = true; updateTools();
    try {
      const ok = await audio.startMic();
      if (ok && recordPending && audio.armed && attempt === recordAttempt) { send({ type: "record", index }); status("Recording, up to 12 seconds. Press Stop recording to finish."); }
    } catch (e) { if (attempt === recordAttempt && !disposed) error(e); }
    if (attempt === recordAttempt) recordPending = false;
    updateTools();
  });
  const monitor = document.createElement("label"); monitor.className = "check-control";
  const check = document.createElement("input"); check.type = "checkbox"; check.id = "monitor";
  monitor.append(check, document.createTextNode("Monitor recording · headphones")); $("instrumentTools").append(monitor);
  on(check, "change", () => audio.setMonitor(check.checked));
} else if (id === "loop-soup") {
  choose(3, "Bowl");
  modeButton = button("Hold selected tape", () => activate());
  extraButton = button("Demo ingredient on", () => setParams({ demo: params.demo > 0.5 ? 0 : 1 }));
  brushButton = button("Erase brush off", () => { brush = !brush; updateTools(); });
  button("Empty selected bowl", () => { if (window.confirm("Erase the selected bowl's recorded contents?")) send({ type: "clear", index: selected }); });
  addMic();
} else if (id === "habit-habitat") {
  choose(6, "Node");
  modeButton = button("Switch to Teach", () => { send({ type: "mode", value: state.mode === "teach" ? "recall" : "teach" }); });
  button("Play / teach selected node", () => activate());
  brushButton = button("Forget brush off", () => { brush = !brush; updateTools(); });
  const routeSelect = (label, value) => {
    const field = document.createElement("label"); field.className = "field-label route-choice"; field.textContent = label;
    const select = document.createElement("select"); select.id = `forget${label}`;
    for (let i = 0; i < 6; i++) select.add(new Option(`Node ${i + 1}`, String(i)));
    select.value = String(value); field.append(select); $("instrumentTools").append(field); return select;
  };
  const from = routeSelect("From", 0), to = routeSelect("To", 1);
  button("Weaken route", () => {
    if (from.value === to.value) { status("Choose two different nodes; there are no self-routes."); return; }
    send({ type: "forget", index: Number(from.value), to: Number(to.value) });
    status(`Weakened route ${Number(from.value) + 1} → ${Number(to.value) + 1}.`);
  });
  button("Save memory", () => {
    try { localStorage.setItem("morphazoid.habit-habitat.v1", JSON.stringify({ version: 1, weights: state.weights })); status("Learned routes saved in this browser."); }
    catch { error("Browser storage is unavailable. Your current routes are still intact."); }
  });
  button("Recall saved memory", () => {
    try {
      const data = JSON.parse(localStorage.getItem("morphazoid.habit-habitat.v1") || "null");
      if (data?.version !== 1 || !Array.isArray(data.weights) || data.weights.length !== 6 ||
        !data.weights.every((row) => Array.isArray(row) && row.length === 6 && row.every(Number.isFinite))) throw Error("No valid saved memory.");
      send({ type: "memory", weights: data.weights }); status("Saved routes recalled.");
    } catch (e) { error(e); }
  });
  button("Forget all routes", () => { if (window.confirm("Erase the currently learned routes? Saved browser memory will not change.")) send({ type: "clear" }); });
} else {
  choose(3, "Chamber");
  button("Strike selected chamber", () => activate());
  modeButton = button("Wall bypass off", () => send({ type: "bypass", value: !state.bypass }));
  const label = document.createElement("label"); label.className = "field-label"; label.textContent = "Source";
  sourceSelect = document.createElement("select"); sourceSelect.id = "source";
  for (const [i, name] of ["Silent · strikes only", "Noise", "Drone", "Microphone"].entries()) sourceSelect.add(new Option(name, String(i)));
  sourceSelect.value = "1"; label.append(sourceSelect); $("instrumentTools").append(label);
  on(sourceSelect, "change", () => setParams({ source: Number(sourceSelect.value) }));
  addMic();
}
if (["tape-worm", "loop-soup", "habit-habitat"].includes(id)) {
  button("Restore demo material", () => {
    if (window.confirm("Replace the current recordings or learned routes with the demo?")) {
      audio.fileGeneration++; recordPending = false;
      recordAttempt++;
      if (id === "tape-worm") audio.stopMic();
      send({ type: "demo" }); status("Demo material restored.");
    }
  });
}

function updateTools() {
  if (disposed) return;
  for (const el of $("selectors").children) el.setAttribute("aria-pressed", String(Number(el.dataset.select) === selected));
  if (modeButton) {
    if (id === "tape-worm") { modeButton.textContent = params.splice > 0.5 ? "Splices on" : "Splices bypassed"; modeButton.setAttribute("aria-pressed", String(params.splice > 0.5)); }
    if (id === "loop-soup") modeButton.textContent = state.modes?.[selected] === "hold" ? "Resume overdub" : "Hold selected tape";
    if (id === "habit-habitat") modeButton.textContent = state.mode === "teach" ? "Switch to Recall" : "Switch to Teach";
    if (id === "hollowphonic") { modeButton.textContent = state.bypass ? "Wall bypass on" : "Wall bypass off"; modeButton.setAttribute("aria-pressed", String(Boolean(state.bypass))); }
  }
  if (extraButton) extraButton.textContent = params.demo > 0.5 ? "Demo ingredient on" : "Demo ingredient off";
  if (sourceSelect) sourceSelect.value = params.source;
  if (brushButton) { brushButton.textContent = `${id === "loop-soup" ? "Erase" : "Forget"} brush ${brush ? "on" : "off"}`; brushButton.setAttribute("aria-pressed", String(brush)); }
  if (micButton) {
    micButton.textContent = micPending ? "Cancel microphone request" : audio.stream ? "Disable microphone" : "Enable microphone";
    micButton.setAttribute("aria-pressed", String(Boolean(audio.stream)));
  }
  if (recordButton) {
    recordButton.textContent = recordPending ? "Cancel recording request" : state.recording ? "Stop recording" : "Record selected tape";
    recordButton.disabled = filePending;
    $("tapeFile").disabled = filePending || recordPending || Boolean(state.recording);
  }
  if (id === "tempo-tantrum") $("modelStatus").textContent = `${state.locked?.filter(Boolean).length || 0} of 3 bodies in step · drag or nudge one`;
  if (id === "tape-worm") $("modelStatus").textContent = `Reader on tape ${(state.tape || 0) + 1}${state.recording ? ` · recording ${state.recording.seconds.toFixed(1)} s` : ""}`;
  if (id === "loop-soup") $("modelStatus").textContent = `Bowl ${selected + 1}: ${state.modes?.[selected] || "overdub"}`;
  if (id === "habit-habitat") $("modelStatus").textContent = `${state.mode === "teach" ? "Teaching" : "Recalling"} · ${state.visits || 0} visits`;
  if (id === "hollowphonic") $("modelStatus").textContent = `Chamber ${selected + 1} · ${Math.round(state.frequencies?.[selected] || 0)} Hz`;
  if (id === "tape-worm") {
    $("modelStatus").textContent = `Reader: Tape ${state.tape ? "B" : "A"} · replace target: Tape ${selected ? "B" : "A"}`;
    $("actionStatus").textContent = state.recording
      ? `Recording Tape ${state.recording.index ? "B" : "A"} · ${state.recording.seconds.toFixed(1)} / 12 s. Pause does not stop recording.`
      : "One reader · two tapes · no graph detection. Leaving this page discards recordings.";
  } else if (id === "loop-soup") {
    const source = audio.stream ? `microphone${params.demo > 0.5 ? " + demo" : ""}` : params.demo > 0.5 ? "demo pluck" : "no new ingredient";
    $("actionStatus").textContent = `Input: ${source}. ${playing ? "Overdub continues while muted; Pause stops writing." : "Paused: tape motion and overdub stopped."}`;
  } else if (id === "hollowphonic") {
    $("actionStatus").textContent = params.source === 0
      ? "No continuous source. Tap a chamber or press Enter to strike."
      : params.source === 3 && !audio.stream
        ? "Microphone source selected, but microphone is off. Enable microphone to hear it."
        : `Source: ${["silent", "noise", "drone", "microphone"][params.source]}${state.bypass ? " · wall bypassed" : " · through resonators"}.`;
  } else if (id === "habit-habitat") {
    $("actionStatus").textContent = state.mode === "teach" ? "Teach listens to manual node visits; Play does not advance the route." : "Recall follows saved weights without teaching itself.";
  } else {
    $("actionStatus").textContent = "Targets: 1 hit per 2 / 3 / 4 drive beats. Listen for recovery, not simultaneous strikes.";
  }
  canvas.dataset.state = JSON.stringify({
    playing, audio: audio.armed, selected, time: state.time,
    phases: state.phases, tape: state.tape, transitions: state.transitions, locked: state.locked,
    mode: state.mode, recording: Boolean(state.recording), params, weights: state.weights, energy: state.energy,
    offsets: state.offsets, modes: state.modes, bypass: state.bypass, phase: state.phase, names: state.names,
    durations: state.durations, mediaVersion: state.mediaVersion, lastRecording: state.lastRecording,
  });
}

function resize() {
  const box = $("stageWrap").getBoundingClientRect(), dpr = Math.min(devicePixelRatio || 1, 1.5);
  canvas.width = Math.max(1, Math.round(box.width * dpr)); canvas.height = Math.max(1, Math.round(box.height * dpr));
  const scale = Math.min(box.width / WORLD.width, box.height / WORLD.height);
  transform = { scale, x: (box.width - WORLD.width * scale) / 2, y: (box.height - WORLD.height * scale) / 2, width: box.width, height: box.height, dpr };
}
const resizeObserver = new ResizeObserver(resize); resizeObserver.observe($("stageWrap")); resize();
function point(event) {
  const box = canvas.getBoundingClientRect();
  return { x: (event.clientX - box.left - transform.x) / transform.scale, y: (event.clientY - box.top - transform.y) / transform.scale };
}
const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
function nearest(p, centers) { return centers.reduce((best, c, i) => distance(p, c) < distance(p, centers[best]) ? i : best, 0); }
function forgetPath(p) {
  let best = null, shortest = 30;
  for (let a = 0; a < 6; a++) for (let b = 0; b < 6; b++) {
    if (a === b || (state.weights?.[a]?.[b] || 0) < 0.3) continue;
    const start = habitNodes[a], end = habitNodes[b];
    const vx = end.x - start.x, vy = end.y - start.y;
    const t = clamp(((p.x - start.x) * vx + (p.y - start.y) * vy) / (vx * vx + vy * vy), 0.15, 0.85);
    const d = distance(p, { x: start.x + t * vx, y: start.y + t * vy });
    if (d < shortest) { shortest = d; best = { type: "forget", index: a, to: b }; }
  }
  if (best) send(best);
}
on(canvas, "pointerdown", (event) => {
  if (event.isPrimary === false || event.button > 0 || pointer) return;
  canvas.focus({ preventScroll: true });
  const p = point(event);
  if (id === "tempo-tantrum") {
    const beads = (state.phases || [0, 0, 0]).map((phase, i) => polar(450, 306, 86 + i * 74 + (state.offsets?.[i] || 0) * 100, phase));
    selected = nearest(p, beads);
  } else if (id === "tape-worm") {
    selected = nearest(p, tapeCenters);
    const gate = polar(tapeCenters[selected].x, tapeCenters[selected].y, 132, params.departure);
    const arrival = polar(tapeCenters[selected].x, tapeCenters[selected].y, 132, params.landing);
    const isGate = distance(p, gate) < 32;
    const isArrival = !isGate && distance(p, arrival) < 26;
    pointer = { id: event.pointerId, gate: isGate, arrival: isArrival, start: p };
    if (!isGate && !isArrival) send({ type: "jump", index: selected, phase: angleAt(p, tapeCenters[selected]) });
  } else if (id === "loop-soup") {
    selected = nearest(p, soupCenters);
    if (brush) send({ type: "erase", index: selected, phase: angleAt(p, soupCenters[selected]) });
  } else if (id === "habit-habitat") {
    if (brush) forgetPath(p);
    else { selected = nearest(p, habitNodes); if (distance(p, habitNodes[selected]) < 65) activate(); }
  } else {
    selected = Math.round(clamp((p.x - 220) / 230, 0, 2));
    activate();
  }
  pointer ??= { id: event.pointerId, start: p };
  pointer.offset = state.offsets?.[selected] || 0;
  canvas.setPointerCapture(event.pointerId); event.preventDefault(); updateTools();
});
on(canvas, "pointermove", (event) => {
  if (!pointer || pointer.id !== event.pointerId) return;
  const p = point(event);
  if (id === "tempo-tantrum") send({ type: "body", index: selected, phase: angleAt(p, { x: 450, y: 306 }),
    offset: clamp(pointer.offset + (distance(p, { x: 450, y: 306 }) - distance(pointer.start, { x: 450, y: 306 })) / 100, -0.45, 0.45) });
  if (id === "tape-worm" && pointer.gate) setParams({ departure: clamp(angleAt(p, tapeCenters[selected]), 0.05, 0.95) });
  if (id === "tape-worm" && pointer.arrival) setParams({ landing: clamp(angleAt(p, tapeCenters[selected]), 0, 0.85) });
  if (id === "loop-soup" && brush) {
    const from = pointer.lastPhase ?? angleAt(pointer.start, soupCenters[selected]);
    const to = angleAt(p, soupCenters[selected]); const delta = ((to - from + 1.5) % 1) - 0.5;
    const steps = Math.max(1, Math.ceil(Math.abs(delta) / 0.035));
    for (let i = 1; i <= steps; i++) send({ type: "erase", index: selected, phase: ((from + delta * i / steps) % 1 + 1) % 1 });
    pointer.lastPhase = to;
  }
  if (id === "hollowphonic") send({ type: "cavity", index: selected, offset: pointer.offset + (p.y - pointer.start.y) / 430 });
  event.preventDefault();
});
function releasePointer(event) {
  if (pointer?.id !== event.pointerId) return;
  if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
  pointer = null;
}
on(canvas, "pointerup", releasePointer); on(canvas, "pointercancel", releasePointer); on(canvas, "lostpointercapture", () => { pointer = null; });
on(canvas, "keydown", (event) => {
  const count = $("selectors").children.length;
  if (/^[1-6]$/.test(event.key) && Number(event.key) <= count) { activate(Number(event.key) - 1); event.preventDefault(); }
  if (event.key === "ArrowLeft" || event.key === "ArrowRight") { selected = (selected + (event.key === "ArrowRight" ? 1 : count - 1)) % count; updateTools(); event.preventDefault(); }
  if (event.key === "Enter") { activate(); event.preventDefault(); }
  if (event.key === "ArrowUp" || event.key === "ArrowDown") {
    const sign = event.key === "ArrowUp" ? 1 : -1;
    if (id === "tempo-tantrum") send({ type: "body", index: selected, offset: (state.offsets?.[selected] || 0) + sign * 0.04 });
    if (id === "hollowphonic") send({ type: "cavity", index: selected, offset: (state.offsets?.[selected] || 0) + sign * 0.04 });
    if (id === "tape-worm") setParams({ departure: params.departure + sign * 0.03 });
    if (id === "loop-soup" && brush) send({ type: "erase", index: selected, phase: state.phases?.[selected] || 0 });
    event.preventDefault();
  }
});
on(document.querySelector('a[href="#howItWorks"]'), "click", () => { $("howItWorks").open = true; });
on(window, "hashchange", () => { if (location.hash === "#howItWorks") $("howItWorks").open = true; });
on(window, "morphazoid:midi-input", (event) => {
  const m = event.detail?.message ?? event.detail;
  if (m?.type === "noteOn") { activate(Math.abs(Math.round(m.note || 0)) % $("selectors").children.length); event.preventDefault(); }
});

function frame(now) {
  if (disposed) return;
  const dt = Math.min(0.12, Math.max(0, (now - previousTime) / 1000)); previousTime = now;
  if (!audio.node) {
    mirror.playing = playing; mirror.advance(dt); state = mirror.snapshot();
  }
  if (now - lastUi > 45 && !document.hidden) {
    lastUi = now;
    const { dpr, scale, x, y, width, height } = transform;
    context.setTransform(dpr, 0, 0, dpr, 0, 0); context.fillStyle = "#080e16"; context.fillRect(0, 0, width, height);
    context.translate(x, y); context.scale(scale, scale);
    renderInstrument(context, id, { ...state, params }, selected, brush);
    updateTools();
  }
  renderId = requestAnimationFrame(frame);
}
on(document, "visibilitychange", () => { previousTime = performance.now(); });
on(window, "pagehide", () => {
  if (disposed) return;
  disposed = true; cancelAnimationFrame(renderId); resizeObserver.disconnect();
  audioAttempt++;
  abort.abort(); audioStrip.destroy(); void audio.close();
});
syncControls(); updateTools(); renderId = requestAnimationFrame(frame);

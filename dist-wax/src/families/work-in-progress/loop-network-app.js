import { STARTING_INSTRUMENTS } from "./catalog.js";
import { INSTRUMENT_HELP, formatParameter } from "./help.js";
import { CORES } from "./cores.js";
import { StartingAudio } from "./audio.js";
import { NetworkView, ringPhase } from "./network-view.js";
import { MAX_LOOPS, MAX_ROUTES, loopPosition, clampPosition } from "./network-ui-utils.js";
import { createAudioStrip } from "../../ui/patterns/audio-strip.js";

const id = document.body.dataset.startingInstrument, tape = id === "tape-worm";
const spec = STARTING_INSTRUMENTS[id], help = INSTRUMENT_HELP[id], $ = (s) => document.getElementById(s);
const preview = new CORES[id](24000);
let state = preview.snapshot(), params = { ...spec.defaults }, playing = false, disposed = false;
let selected = state.loops[0].id, selectedRoute = state.routes[0]?.id ?? null, connecting = null;
let starting = false, audioAttempt = 0, micAttempt = 0, micPending = false, keepMic = false;
let pendingRecord = null, recordAttempt = 0, filePending = false, drag = null, frameId, lastFrame = performance.now();
let lastPaint = 0, brush = false, lastStructure = "", lastRoutes = "";
let requestedLoop = null, requestedRoute = null;
const abort = new AbortController(), on = (n, e, f) => n.addEventListener(e, f, { signal: abort.signal });
const status = (s) => { $("liveStatus").textContent = s; };
const loopById = (key) => state.loops.find((l) => l.id === key);
const selectedLoop = () => loopById(selected);
function error(e) {
  if (disposed) return;
  $("audioError").hidden = false; $("audioError").textContent = e instanceof Error ? e.message : String(e);
  strip?.setAudioState(audio.armed ? "on" : "off");
}
const audio = new StartingAudio(id, (next) => {
  if (disposed) return;
  const wasRecording = state.recording;
  state = next; params = { ...next.params };
  if (wasRecording && !next.recording) {
    pendingRecord = null;
    if (!keepMic) audio.stopMic();
    status(next.lastRecording?.accepted ? "Recording installed. Existing routes and other loops retained." : "Recording stopped; previous audio retained.");
  }
  if (!loopById(selected)) selected = state.loops[0].id;
  update();
}, error);
const strip = createAudioStrip({
  buttonId: "audioButton", levelId: "level", level: 0.48, min: 0, max: 0.72, step: 0.01,
  onAudioClick: toggleAudio, onLevelInput: (v) => audio.setLevel(v),
});
$("audioSlot").replaceWith(strip);
function send(m) {
  if (disposed) return;
  if (audio.node) audio.send(m);
  else { preview.command(m); state = preview.snapshot(); params = { ...state.params }; update(); }
}
function snapshot() { return { ...state, params, playing, tapeData: preview.buffers }; }
async function toggleAudio() {
  const attempt = ++audioAttempt; $("audioError").hidden = true;
  if (starting || audio.armed) {
    starting = false; recordAttempt++; pendingRecord = null; micAttempt++; micPending = false; keepMic = false;
    audio.mute(); strip.setAudioState("off"); status(playing ? "Audio is off — turn it on to hear playback" : "Audio off."); update(); return;
  }
  starting = true; strip.setAudioState("starting");
  try {
    const ok = await audio.arm(snapshot);
    if (disposed || attempt !== audioAttempt) return;
    starting = false; strip.setAudioState(ok ? "on" : "off");
    if (ok) status("Audio on. Use Play for the network; each loop has its own controls.");
  } catch (e) { if (attempt === audioAttempt) { starting = false; strip.setAudioState("off"); error(e); } }
  update();
}
function button(parent, text, fn, name) {
  const b = document.createElement("button"); b.type = "button"; b.className = "mini-action"; b.textContent = text;
  if (name) b.id = name; on(b, "click", fn); parent.append(b); return b;
}
function labelSelect(parent, text, name) {
  const label = document.createElement("label"); label.className = "field-label"; label.textContent = text;
  const select = document.createElement("select"); select.id = name; label.append(select); parent.append(label); return select;
}
function field(parent, name, label, min, max, step, change, format = (v) => `${Math.round(v * 100)}%`) {
  const el = document.createElement("label"); el.className = "control"; el.htmlFor = name;
  const row = document.createElement("span"), title = document.createElement("b"), output = document.createElement("output");
  title.textContent = label; output.id = name + "Out"; output.htmlFor = name; row.append(title, output);
  const input = document.createElement("input"); Object.assign(input, { type: "range", id: name, min, max, step });
  el.append(row, input); parent.append(el);
  on(input, "input", () => change(Number(input.value)));
  return { input, set(v) { if (document.activeElement !== input) input.value = v; output.value = format(v); } };
}
function play(value) {
  playing = value; send({ type: "play", value }); update();
  status(!audio.armed && playing ? "Audio is off — turn it on to hear playback" : playing ? "Network playing." : "Network paused. An active microphone recording is independent; use its Stop or Pause button.");
}
on($("playButton"), "click", () => play(!playing));
on($("resetButton"), "click", () => { send({ type: "reset" }); brush = false; connecting = null; status("Controls reset. Loops, layout, recorded audio and routes retained."); });
const preset = $("preset"); preset.add(new Option("Custom", "")); preset.options[0].disabled = true;
for (const name of Object.keys(spec.presets)) preset.add(new Option(name, name));
on(preset, "change", () => { send({ type: "params", values: spec.presets[preset.value] }); status(tape ? "Preset applied. Global gate positions set all routes; audio and topology retained." : "Preset applied; loops and routes retained."); });
for (const c of spec.controls) on($(c.key), "input", () => send({ type: "params", values: { [c.key]: Number($(c.key).value) } }));

const tools = $("instrumentTools"); tools.className = "network-tools";
const lengthLabel = document.createElement("label"); lengthLabel.className = "field-label"; lengthLabel.textContent = "New empty loop length (seconds)";
const length = document.createElement("input"); Object.assign(length, { type: "number", min: "0.25", max: "12", step: "0.25", value: "2", id: "newLoopLength" }); lengthLabel.append(length); tools.append(lengthLabel);
const add = button(tools, "Add loop", () => {
  if (state.loops.length >= MAX_LOOPS) return;
  requestedLoop = `loop-${state.nextLoopId}`;
  send({ type: "add-loop", seconds: Number(length.value), connect: tape });
  status(tape ? "Added an empty loop; linked after the last loop. Record into its center." : "Added an empty loop. Connect routes or record into its center.");
}, "addLoop");
const remove = button(tools, "Remove selected", () => {
  const loop = selectedLoop();
  if (state.loops.length < 2 || !confirm(`Remove loop ${loop.label}, its recording and attached routes? Other loops keep playing.`)) return;
  if (connecting === loop.id) connecting = null;
  if (pendingRecord === loop.id) { recordAttempt++; pendingRecord = null; if (!keepMic) audio.stopMic(); }
  if (state.recording?.loopId === loop.id) { send({ type: "cancel-record" }); if (!keepMic) audio.stopMic(); }
  audio.fileGeneration++; send({ type: "remove-loop", loopId: loop.id });
  status(`Removed loop ${loop.label} and only its attached routes.`);
}, "removeLoop");
button(tools, "Arrange loops", () => { state.loops.forEach((l, i) => send({ type: "move-loop", loopId: l.id, ...loopPosition(i) })); status("Layout arranged. Timing and recordings unchanged."); }, "arrangeLoops");
const connectButton = button(tools, "Connect selected", () => beginConnect(selected), "connectLoop");
const micButton = button(tools, "Enable microphone", toggleMic, "microphoneButton");
const monitorLabel = document.createElement("label"); monitorLabel.className = "check-control";
const monitor = document.createElement("input"); monitor.type = "checkbox"; monitor.id = "monitor";
monitorLabel.append(monitor, document.createTextNode("Monitor microphone · headphones")); tools.append(monitorLabel);
on(monitor, "change", () => audio.setMonitor(monitor.checked));
async function toggleMic() {
  const attempt = ++micAttempt;
  if (audio.stream || micPending || pendingRecord) {
    micPending = false; keepMic = false; recordAttempt++; pendingRecord = null;
    send({ type: "finish-record" }); audio.stopMic(); status("Microphone off."); update(); return;
  }
  micPending = true; update();
  try {
    const ok = await audio.startMic();
    if (disposed || attempt !== micAttempt) return;
    if (ok) { keepMic = true; if (!tape) send({ type: "params", values: { demo: 0 } }); status("Microphone enabled. Record captures only the selected loop; Monitor is optional."); }
  } catch (e) { if (attempt === micAttempt) error(e); }
  if (attempt === micAttempt) micPending = false; update();
}
async function record(loopId) {
  const loop = loopById(loopId); if (!loop) return;
  if (filePending) { status("Wait for the current file load before recording."); return; }
  if (pendingRecord === loopId) { recordAttempt++; pendingRecord = null; if (!keepMic) audio.stopMic(); update(); return; }
  if (state.recording?.loopId === loopId) { send({ type: "finish-record" }); return; }
  if (state.recording || pendingRecord) { status("Finish the current recording first."); return; }
  if (!audio.armed || !audio.node) { error("Turn Audio on first. Recording never arms audio automatically."); return; }
  if (loop.name !== "Empty tape" && !confirm(`Replace the recording in loop ${loop.label}? The old tape stays until this take is finished.`)) return;
  const attempt = ++recordAttempt; pendingRecord = loopId; update();
  try {
    const ok = await audio.startMic();
    if (ok && !disposed && attempt === recordAttempt && loopById(loopId)) {
      send({ type: "record", loopId }); if (!tape) send({ type: "params", values: { demo: 0 } });
      status(`Recording microphone into ${loop.label}. Stop installs the take; Pause inside ${loop.label} pauses capture.`);
    }
  } catch (e) { if (attempt === recordAttempt) error(e); }
  if (attempt === recordAttempt) pendingRecord = null; update();
}
const fileLabel = document.createElement("label"); fileLabel.className = "file-control"; fileLabel.textContent = "Replace selected loop · audio file";
const file = document.createElement("input"); Object.assign(file, { type: "file", accept: "audio/*", id: "tapeFile" }); fileLabel.append(file); tools.append(fileLabel);
on(file, "change", async () => {
  const input = file.files?.[0], loop = selectedLoop();
  if (!input || filePending || !loop || pendingRecord || state.recording) return;
  if (!confirm(`Replace loop ${loop.label} with ${input.name}?`)) { file.value = ""; return; }
  filePending = true; update();
  try { const message = await audio.loadFile(input, loop.id); if (message && loopById(loop.id)) status(`${loop.label}: ${message}`); }
  catch (e) { error(e); }
  filePending = false; file.value = ""; update();
});
let demoInputButton, eraseButton;
if (tape) button(tools, "Toggle route bypass", () => send({ type: "params", values: { splice: params.splice > 0.5 ? 0 : 1 } }), "bypassRoutes");
else {
  demoInputButton = button(tools, "Demo input on", () => send({ type: "params", values: { demo: params.demo > 0.5 ? 0 : 1 } }), "demoInput");
  eraseButton = button(tools, "Erase brush off", () => { brush = !brush; update(); }, "eraseBrush");
}
button(tools, "Clear selected audio", () => { if (confirm(`Erase audio in loop ${selectedLoop().label}?`)) send({ type: "clear", loopId: selected }); }, "clearLoop");
button(tools, "Restore demo network", () => {
  if (!confirm("Replace all loops, recordings and routes with the demo network?")) return;
  audio.fileGeneration++; recordAttempt++; pendingRecord = null; micAttempt++; micPending = false; keepMic = false;
  audio.stopMic(); send({ type: "demo" }); connecting = null; status("Demo network restored.");
}, "restoreNetwork");
const inspector = document.createElement("div"); inspector.className = "network-inspector"; tools.append(inspector);
const heading = document.createElement("h2"); heading.textContent = "Selected loop"; inspector.append(heading);
const levelField = field(inspector, "loopLevel", "Level", 0, 1, 0.01, (v) => send({ type: "loop", loopId: selected, values: { level: v } }));
const panField = field(inspector, "loopPan", "Pan", -0.85, 0.85, 0.01, (v) => send({ type: "loop", loopId: selected, values: { pan: v } }), (v) => v === 0 ? "Center" : `${Math.round(Math.abs(v) * 100)}% ${v < 0 ? "L" : "R"}`);
const routePanel = document.createElement("section"); routePanel.className = "network-inspector"; routePanel.setAttribute("aria-label", "Route controls"); tools.append(routePanel);
const routeTitle = document.createElement("h2"); routeTitle.textContent = tape ? "Head-transfer routes" : "Audio-feed routes"; routePanel.append(routeTitle);
const from = labelSelect(routePanel, "From", "routeFrom"), to = labelSelect(routePanel, "To", "routeTo");
const attach = button(routePanel, "Attach route", () => connect(from.value, to.value), "attachRoute");
const routePicker = labelSelect(routePanel, "Edit route", "routePicker");
on(routePicker, "change", () => { selectedRoute = routePicker.value; update(); });
const fields = [];
const changeRoute = (key, value) => send({ type: "route", routeId: selectedRoute, values: { [key]: value } });
if (tape) {
  fields.push(["departure", field(routePanel, "routeDeparture", "Exit position", 0.02, 0.98, 0.01, (v) => changeRoute("departure", v))]);
  fields.push(["landing", field(routePanel, "routeLanding", "Entry position", 0, 0.95, 0.01, (v) => changeRoute("landing", v))]);
  fields.push(["fade", field(routePanel, "routeFade", "Crossfade", 0.005, 0.15, 0.001, (v) => changeRoute("fade", v), (v) => `${Math.round(v * 1000)} ms`)]);
} else {
  fields.push(["gain", field(routePanel, "routeGain", "Send level", 0, 1, 0.01, (v) => changeRoute("gain", v))]);
  fields.push(["tone", field(routePanel, "routeTone", "Low-pass tone", 0, 1, 0.01, (v) => changeRoute("tone", v), (v) => `${Math.round(120 * 100 ** v)} Hz`)]);
}
const routeEnable = button(routePanel, "Disable route", () => {
  const r = state.routes.find((r) => r.id === selectedRoute); if (r) changeRoute("enabled", !r.enabled);
}, "routeEnable");
const detach = button(routePanel, "Detach route", () => { if (selectedRoute) send({ type: "disconnect", routeId: selectedRoute }); }, "detachRoute");
const routeNote = document.createElement("p"); routeNote.className = "starting-note"; routeNote.textContent = tape
  ? "Earliest enabled exit wins. Tied exits alternate. Paused targets are skipped; muting does not change traversal."
  : "Feeds the destination's overdub input, not its monitor mix. Hold/paused destinations do not write. Mute also closes outgoing sends; Solo affects monitoring only.";
routePanel.append(routeNote);

function select(loopId) {
  if (!loopById(loopId)) return;
  if (connecting) { connect(connecting, loopId); return; }
  selected = loopId; update();
}
function beginConnect(loopId) {
  connecting = connecting === loopId ? null : loopId; brush = false;
  status(connecting ? `Connect from ${loopById(loopId).label}: click another loop's letter, or use From / To.` : "Connection cancelled.");
  update();
}
function connect(a, b) {
  if (a === b) { status("Choose a different destination loop."); return; }
  if (!loopById(a) || !loopById(b)) return;
  if (state.routes.length >= MAX_ROUTES && !state.routes.some((r) => r.from === a && r.to === b)) { status("Route limit reached; detach a route first."); return; }
  const old = state.routes.find((r) => r.from === a && r.to === b);
  requestedRoute = old?.id ?? `route-${state.nextRouteId}`; send({ type: "connect", from: a, to: b }); connecting = null;
  status(`${loopById(a).label} → ${loopById(b).label} attached. Its parameters are in Route controls.`); update();
}
function toggle(loopId, key) {
  const loop = loopById(loopId); if (!loop) return;
  send({ type: "loop", loopId, values: { [key]: !loop[key] } });
}
function transport(loopId) {
  const loop = loopById(loopId); if (!loop) return;
  // A triangle must actually start/resume, even while global Play is stopped.
  // Capture pause remains local and must not start playback as a side effect.
  const capturing = state.recording?.loopId === loopId;
  const running = !loop.paused && (playing || capturing);
  const isReader = tape && state.loops[state.tape]?.id === loopId;
  const readerPhase = state.phase;
  send({ type: "loop", loopId, values: { paused: running } });
  if (!running && !playing && !capturing) {
    if (tape) send({ type: "jump", loopId, phase: isReader ? readerPhase : 0 });
    play(true);
  }
}
function activate(loopId) {
  const loop = loopById(loopId); if (!loop) return;
  if (tape) { send({ type: "jump", loopId, phase: 0 }); if (!playing) play(true); }
  else send({ type: "mode", loopId, value: loop.mode === "hold" ? "overdub" : "hold" });
}
function point(e) {
  const rect = $("networkSurface").getBoundingClientRect(); return { x: e.clientX - rect.left, y: e.clientY - rect.top };
}
function startDrag(e, loopId) {
  if (e.button > 0 || e.isPrimary === false || drag || connecting) return;
  const l = loopById(loopId); selected = loopId;
  drag = { type: "loop", pointerId: e.pointerId, target: e.currentTarget, loopId, start: point(e), origin: { x: l.x, y: l.y } };
  e.currentTarget.setPointerCapture(e.pointerId); e.preventDefault(); update();
}
function startGate(e, routeId, key) {
  if (e.button > 0 || e.isPrimary === false || drag) return;
  selectedRoute = routeId;
  drag = { type: "gate", pointerId: e.pointerId, target: e.currentTarget, routeId, key };
  e.currentTarget.setPointerCapture(e.pointerId); e.preventDefault(); update();
}
function ring(e, loopId) {
  if (e.button > 0 || drag) return;
  if (connecting) { select(loopId); return; }
  selected = loopId; const phase = ringPhase(loopById(loopId), point(e));
  if (tape) send({ type: "jump", loopId, phase });
  else if (brush) {
    send({ type: "erase", loopId, phase }); drag = { type: "erase", pointerId: e.pointerId, target: e.currentTarget, loopId, phase };
    e.currentTarget.setPointerCapture(e.pointerId);
  }
  e.preventDefault(); update();
}
const view = new NetworkView($("networkSurface"), tape, { select, record, toggle, transport, activate, connect: beginConnect,
  selectRoute: (routeId, reveal = true) => { selectedRoute = routeId; update(); if (reveal) routePanel.scrollIntoView({ block: "nearest" }); }, drag: startDrag, gate: startGate, ring,
  moveKey(loopId, key, step) {
    const l = loopById(loopId);
    send({ type: "move-loop", loopId, ...clampPosition(l.x + (key === "ArrowRight" ? step : key === "ArrowLeft" ? -step : 0), l.y + (key === "ArrowDown" ? step : key === "ArrowUp" ? -step : 0)) });
  },
}, abort.signal);
on(window, "pointermove", (e) => {
  if (!drag || drag.pointerId !== e.pointerId) return;
  const p = point(e);
  if (drag.type === "loop") {
    const pos = clampPosition(drag.origin.x + p.x - drag.start.x, drag.origin.y + p.y - drag.start.y);
    drag.position = pos; send({ type: "move-loop", loopId: drag.loopId, ...pos });
  } else if (drag.type === "gate") {
    const r = state.routes.find((r) => r.id === drag.routeId); if (!r) return;
    const loop = loopById(drag.key === "departure" ? r.from : r.to);
    send({ type: "route", routeId: r.id, values: { [drag.key]: ringPhase(loop, p) } });
  } else {
    const phase = ringPhase(loopById(drag.loopId), p);
    const delta = ((phase - drag.phase + 1.5) % 1) - 0.5, steps = Math.max(1, Math.ceil(Math.abs(delta) / 0.04));
    for (let i = 1; i <= steps; i++) send({ type: "erase", loopId: drag.loopId, phase: (drag.phase + delta * i / steps + 1) % 1 });
    drag.phase = phase;
  }
  e.preventDefault();
});
function release(e) {
  if (!drag || drag.pointerId !== e.pointerId) return;
  const target = drag.target; drag = null;
  if (target.hasPointerCapture(e.pointerId)) target.releasePointerCapture(e.pointerId);
}
on(window, "pointerup", release); on(window, "pointercancel", release);
on(window, "keydown", (e) => { if (e.key === "Escape") { connecting = null; brush = false; update(); } });
on($("networkViewport"), "keydown", (e) => {
  if (e.target !== $("networkViewport") || e.altKey || e.ctrlKey || e.metaKey) return;
  if (/^[1-8]$/.test(e.key)) {
    const l = state.loops[Number(e.key) - 1]; if (l) { selected = l.id; view.focus(l.id); update(); }
  }
  if (e.key === "Enter") { activate(selected); e.preventDefault(); }
});
on(window, "morphazoid:midi-input", (e) => {
  const m = e.detail?.message ?? e.detail;
  if (m?.type === "noteOn") { const l = state.loops[Math.abs(Math.round(m.note || 0)) % state.loops.length]; selected = l.id; activate(l.id); e.preventDefault(); }
});
on(document.querySelector('a[href="#howItWorks"]'), "click", () => { $("howItWorks").open = true; });
function options(select, items) {
  const old = select.value; select.replaceChildren(...items.map(([v, text]) => new Option(text, v)));
  if (items.some(([v]) => v === old)) select.value = old;
}
function update() {
  if (disposed || !view) return;
  let focusLoop = null;
  if (requestedLoop && loopById(requestedLoop)) { selected = requestedLoop; focusLoop = requestedLoop; requestedLoop = null; }
  if (requestedRoute && state.routes.some((r) => r.id === requestedRoute)) { selectedRoute = requestedRoute; requestedRoute = null; }
  if (!selectedLoop()) selected = state.loops[0].id;
  if (connecting && !loopById(connecting)) connecting = null;
  const structure = state.loops.map((l) => l.id).join("|");
  if (structure !== lastStructure) {
    $("selectors").replaceChildren();
    for (const l of state.loops) {
      const b = button($("selectors"), l.label, () => { select(l.id); view.focus(l.id); }); b.dataset.loop = l.id;
    }
    const items = state.loops.map((l) => [l.id, l.label]); options(from, items); options(to, items);
    if (from.value === to.value && items.length > 1) to.value = items[1][0];
    lastStructure = structure;
  }
  const routes = state.routes.map((r) => `${r.id}:${r.from}:${r.to}`).join("|");
  if (routes !== lastRoutes) {
    options(routePicker, state.routes.map((r) => [r.id, `${loopById(r.from)?.label} → ${loopById(r.to)?.label}`]));
    lastRoutes = routes;
  }
  if (!state.routes.some((r) => r.id === selectedRoute)) selectedRoute = state.routes[0]?.id ?? null;
  routePicker.value = selectedRoute ?? "";
  const route = state.routes.find((r) => r.id === selectedRoute);
  for (const [key, f] of fields) { f.input.disabled = !route; if (route) f.set(route[key]); }
  routeEnable.disabled = detach.disabled = !route; attach.disabled = state.loops.length < 2 || state.routes.length >= MAX_ROUTES;
  routeEnable.textContent = route?.enabled ? "Disable route" : "Enable route";
  routeEnable.setAttribute("aria-pressed", String(Boolean(route?.enabled)));
  add.disabled = state.loops.length >= MAX_LOOPS; remove.disabled = state.loops.length <= 1;
  file.disabled = filePending || Boolean(pendingRecord || state.recording);
  heading.textContent = `Loop ${selectedLoop().label}`; levelField.set(selectedLoop().level); panField.set(selectedLoop().pan);
  connectButton.textContent = connecting ? `Cancel connection from ${loopById(connecting)?.label ?? ""}` : "Connect selected";
  for (const b of $("selectors").children) b.setAttribute("aria-pressed", String(b.dataset.loop === selected));
  $("playButton").textContent = playing ? "Pause" : "Play"; $("playButton").setAttribute("aria-pressed", String(playing));
  for (const c of spec.controls) {
    if (document.activeElement !== $(c.key)) $(c.key).value = params[c.key];
    $(`${c.key}Out`).value = formatParameter(id, c, params[c.key]);
  }
  const match = Object.entries(spec.presets).find(([, p]) => Object.keys(p).every((k) => Math.abs(p[k] - params[k]) < 1e-8));
  if (document.activeElement !== preset) preset.value = match?.[0] ?? "";
  $("presetHint").textContent = match ? help.presets[match[0]] : "Custom settings · routes and recordings retained.";
  micButton.textContent = micPending ? "Cancel microphone request" : audio.stream ? "Disable microphone" : "Enable microphone";
  micButton.setAttribute("aria-pressed", String(Boolean(audio.stream)));
  if (demoInputButton) demoInputButton.textContent = params.demo > 0.5 ? "Demo input on" : "Demo input off";
  if (eraseButton) { eraseButton.textContent = brush ? "Erase brush on" : "Erase brush off"; eraseButton.setAttribute("aria-pressed", String(brush)); }
  $("modelStatus").textContent = `${state.loops.length} loops · ${state.routes.length} routes${tape ? ` · reader ${state.loops[state.tape]?.label}` : ""}`;
  $("actionStatus").textContent = connecting ? `From ${loopById(connecting)?.label}: click destination letter. Escape cancels.`
    : state.recording ? `Mic → ${loopById(state.recording.loopId)?.label} · ${state.recording.seconds.toFixed(1)} s${state.recording.paused ? " · paused" : ""}`
      : `${audio.stream ? "Microphone on" : "Microphone off"} · ${tape ? "routes move the reader" : "routes feed overdub"} · unsaved audio stays on this page.`;
  const drawing = drag?.type === "loop" && drag.position ? { ...state, loops: state.loops.map((l) => l.id === drag.loopId ? { ...l, ...drag.position } : l) } : state;
  view.update(drawing, selected, selectedRoute, connecting, pendingRecord);
  if (focusLoop) view.focus(focusLoop);
  $("stage").dataset.state = JSON.stringify({ ...state, waves: undefined, params, playing, audio: audio.armed,
    selected: state.loops.findIndex((l) => l.id === selected), selectedLoopId: selected, selectedRoute, recordingInfo: state.recording, recording: Boolean(state.recording) });
}
function frame(now) {
  if (disposed) return;
  const dt = Math.min(0.12, Math.max(0, (now - lastFrame) / 1000)); lastFrame = now;
  if (!audio.node) { preview.playing = playing; preview.advance(dt); state = preview.snapshot(); params = { ...state.params }; }
  if (now - lastPaint > 45 && !document.hidden) { update(); lastPaint = now; }
  frameId = requestAnimationFrame(frame);
}
on(window, "pagehide", () => { if (disposed) return; disposed = true; audioAttempt++; micAttempt++; recordAttempt++; abort.abort(); cancelAnimationFrame(frameId); strip.destroy(); void audio.close(); });
update(); frameId = requestAnimationFrame(frame);

import {
  Graph3DModel, Graph3DTraversal, GRAPH_3D_DEFAULTS, GRAPH_3D_SCENES, DEFAULT_VIEW,
  clamp, projectGraphPoint, dragGraphPoint, graph3DEdgeParameters, graph3DVoice,
} from "./src/graph-3d.js";
import { GraphSynthAudio } from "./src/graph-synth-audio.js";
import { createAudioStrip } from "./src/ui/patterns/audio-strip.js";

const $ = (id) => document.getElementById(id);
const model = new Graph3DModel(), traversal = new Graph3DTraversal(), audio = new GraphSynthAudio();
const canvas = $("stage"), context = canvas.getContext("2d", { alpha: false });
const abort = new AbortController(), on = (n, e, fn, options = {}) => n.addEventListener(e, fn, { signal: abort.signal, ...options });
const view = { ...DEFAULT_VIEW };
let playing = false, armed = false, starting = false, generation = 0, disposed = false;
let selected = 0, selectedEdge = 0, nextPulse = 0, epoch = 0, lastTick = performance.now() / 1000;
let pauseAt = lastTick, drag = null, frameId = 0, lastPaint = 0, lastRotation = performance.now();
let width = 900, height = 650, dpr = 1, forceAccumulator = 0, graph = model.graph(), edgeMetrics = [];
let lookahead = 0.12, observed = [], routesSignature = "", pendingTriggers = 0, lastModelUi = 0;
let timer = null;
const flashes = new Float64Array(24), colors = ["#a7a4ff", "#67dbc4", "#f3b77e", "#82b6ec"];
const numberFields = [...document.querySelectorAll("[data-parameter]")];
const status = (s) => { $("liveStatus").textContent = s; };
const error = (e) => { $("audioError").hidden = false; $("audioError").textContent = e?.message ?? String(e); };
const now = () => audio.context?.state === "running" ? audio.context.currentTime + epoch : performance.now() / 1000;
const strip = createAudioStrip({ buttonId: "audioButton", levelId: "level", level: 0.48, min: 0, max: 0.8, step: 0.01,
  onAudioClick: toggleAudio, onLevelInput: (v) => audio.setOutput(armed ? v : 0) });
$("audioSlot").replaceWith(strip);
audio.setOutput(0);

function refreshGraph() { graph = model.graph(); edgeMetrics = graph3DEdgeParameters(graph, model.settings); }
function change(values) {
  if (drag) finish({ pointerId: drag.id }, true);
  const structural = model.set(values);
  if (structural) {
    traversal.clear(); observed = []; audio.silence(); selected = Math.min(selected, model.nodes.length - 1); selectedEdge = 0;
    nextPulse = now() + 0.025;
  }
  refreshGraph(); syncControls(); updateInspector();
}
async function toggleAudio() {
  $("audioError").hidden = true;
  const attempt = ++generation;
  if (armed || starting) {
    starting = false; armed = false; audio.silence(); audio.setOutput(0); strip.setAudioState("off");
    if (!audio.context || !audio.input) void audio.close();
    status(playing ? "Audio is off — turn it on to hear playback" : "Audio off."); return;
  }
  starting = true; strip.setAudioState("starting");
  const before = now();
  try {
    await audio.start();
    if (disposed || attempt !== generation) return;
    epoch = performance.now() / 1000 - audio.context.currentTime;
    const delta = now() - before;
    // Rendering was advancing silently; no traversal is relaunched here.
    if (!Number.isFinite(delta)) throw new Error("Audio clock could not start.");
    lastTick = now(); armed = true; starting = false;
    audio.setOutput(strip.level); strip.setAudioState("on"); status(playing ? "Audio joined the running graph." : "Audio on. Play or send a note.");
  } catch (e) {
    if (attempt !== generation || disposed) return;
    starting = false; armed = false; strip.setAudioState("off"); error(e);
  }
}
function setPlaying(value) {
  const time = now();
  if (playing === value) return;
  if (value) {
    const delta = time - pauseAt; traversal.shift(delta); observed = [];
    nextPulse = time + 0.025; playing = true;
  } else {
    playing = false; pauseAt = time; manualUntil = 0; audio.silence();
    // Already submitted native arrivals are cancelled. Resume proceeds from
    // the remaining frontier, without replaying old attacks.
  }
  syncControls(); status(!armed && playing ? "Audio is off — turn it on to hear playback" : playing ? "Graph playing." : "Paused. Send note still auditions one traversal.");
}
function inject(nodeId = selected, note = model.settings.rootMidiNote, velocity = 0.85) {
  traversal.inject(graph, now() + 0.02, nodeId, velocity, note);
  if (!armed) status("Audio is off — turn it on to hear playback");
}
function emit(event, voice) {
  observed.push({ ...event, nodePosition: { ...graph.nodes[event.nodeId] }, frequency: voice?.frequency });
  if (observed.length > 192) observed.splice(0, observed.length - 192);
  if (!armed || starting || !audio.context || !voice || !voice.inAudibleRange || pendingTriggers > 40) return;
  const startAt = event.time - epoch;
  if (startAt < audio.context.currentTime - 0.015) return;
  pendingTriggers++;
  const attempt = generation;
  audio.trigger(voice, { startAt, attackSeconds: model.settings.attack, decaySeconds: model.settings.decay })
    .catch((e) => { if (!disposed && armed && attempt === generation && e?.name !== "AbortError") error(e); })
    .finally(() => { pendingTriggers--; });
}
function tick() {
  if (disposed || document.hidden) return;
  const time = now(), dt = Math.max(0, Math.min(0.12, time - lastTick)); lastTick = time;
  if (model.settings.motion && !drag?.node) {
    forceAccumulator += dt;
    while (forceAccumulator >= 1 / 120) { model.step(1 / 120); forceAccumulator -= 1 / 120; }
    refreshGraph();
  }
  if (playing && time >= nextPulse - lookahead) {
    const interval = model.settings.pulseBeats * 60 / model.settings.tempo;
    if (nextPulse < time - 0.025) nextPulse = time + 0.02;
    let limit = 0;
    while (nextPulse <= time + lookahead && limit++ < 3) {
      traversal.inject(graph, nextPulse, selected, 0.85, model.settings.rootMidiNote);
      nextPulse += interval;
    }
  }
  // Send-note traversals are intentionally available while automatic Play is off.
  if (playing || manualUntil > time) traversal.process(time, time + lookahead, graph, model.settings, emit);
  if (time - lastModelUi > 0.15) { lastModelUi = time; updateInspector(false); }
}
let manualUntil = 0;
function sendNote(nodeId = selected, note = model.settings.rootMidiNote, velocity = 0.85) {
  if (!playing && manualUntil < now()) { traversal.clear(); observed = []; }
  inject(nodeId, note, velocity); manualUntil = now() + 17;
}
on($("playButton"), "click", () => setPlaying(!playing));
on($("sendButton"), "click", () => sendNote());
on($("panicButton"), "click", () => {
  setPlaying(false); traversal.clear(); observed = []; manualUntil = 0; audio.silence(); flashes.fill(0);
  status("All graph notes and pending arrivals cleared. Audio arm unchanged.");
});
on($("resetAll"), "click", () => {
  const wasPlaying = playing;
  model.settings = { ...GRAPH_3D_DEFAULTS }; model.generate(); traversal.clear(); observed = [];
  audio.silence(); selected = selectedEdge = 0; forceAccumulator = 0; nextPulse = now() + 0.025;
  Object.assign(view, DEFAULT_VIEW); playing = wasPlaying; refreshGraph(); syncControls(); updateInspector();
  status("Graph, forces and view reset. Audio and Play retained.");
});
for (const field of numberFields) on(field, field.tagName === "SELECT" ? "change" : "input", () => {
  const key = field.dataset.parameter, value = field.type === "checkbox" ? field.checked : field.tagName === "SELECT" && !["pulseBeats"].includes(key) ? field.value : Number(field.value);
  change({ [key]: value });
  if (["tempo", "pulseBeats"].includes(key)) nextPulse = now() + 0.025;
  $("scene").value = "";
});
for (const name of Object.keys(GRAPH_3D_SCENES)) $("scene").add(new Option(name, name));
$("scene").value = "Orbital branches";
on($("scene"), "change", () => {
  const values = GRAPH_3D_SCENES[$("scene").value]; if (!values) return;
  if (drag) finish({ pointerId: drag.id }, true);
  model.settings = { ...values }; model.generate();
  traversal.clear(); observed = []; audio.silence(); selected = selectedEdge = 0;
  forceAccumulator = 0; nextPulse = now() + 0.025;
  refreshGraph(); syncControls(); updateInspector();
  status("Preset loaded. Graph edits replaced; Camera, Audio and Play retained.");
});
on($("arrangeButton"), "click", () => { model.arrange(); refreshGraph(); updateInspector(); status("Unpinned nodes returned to the chosen 3D arrangement."); });
on($("nextSeed"), "click", () => change({ seed: model.settings.seed % 9999 + 1 }));
on($("releasePins"), "click", () => { model.nodes.forEach((n) => { n.pinned = false; }); refreshGraph(); updateInspector(); status("All nodes released to organizing forces."); });
on($("pinNode"), "click", () => { model.nodes[selected].pinned = !model.nodes[selected].pinned; refreshGraph(); updateInspector(); });
on($("nodeSelect"), "change", () => { selected = Number($("nodeSelect").value); updateInspector(); });
for (const axis of ["x", "y", "z"]) on($(`node${axis.toUpperCase()}`), "input", () => {
  const point = { ...graph.nodes[selected], [axis]: Number($(`node${axis.toUpperCase()}`).value) };
  model.setWorldPoint(selected, point); refreshGraph(); updateInspector(false);
});
on($("routeSelect"), "change", () => { selectedEdge = Number($("routeSelect").value); updateInspector(); });
function toggleEdge() { model.toggleEdge(selectedEdge); refreshGraph(); updateInspector(); status(`Route ${selectedEdge + 1} ${graph.edges[selectedEdge]?.enabled ? "enabled" : "disabled"}.`); }
on($("routeSwitch"), "click", toggleEdge);
on($("viewReset"), "click", () => { Object.assign(view, DEFAULT_VIEW); syncView(); });
on($("zoomIn"), "click", () => { view.zoom = clamp(view.zoom * 1.18, 0.5, 1.9); syncView(); });
on($("zoomOut"), "click", () => { view.zoom = clamp(view.zoom / 1.18, 0.5, 1.9); syncView(); });
on($("autoRotate"), "click", () => { view.auto = !view.auto; syncView(); });
on($("viewFront"), "click", () => { view.yaw = view.pitch = 0; view.auto = false; syncView(); });
on($("viewSide"), "click", () => { view.yaw = 90; view.pitch = 0; view.auto = false; syncView(); });
on($("savePatch"), "click", () => {
  try { localStorage.setItem("morphazoid.graph-3d.v1", JSON.stringify(model.snapshot())); status("3D graph patch saved in this browser. Camera/transport are not saved."); }
  catch { error("Browser storage is unavailable; your current graph is unchanged."); }
});
on($("loadPatch"), "click", () => {
  try {
    const value = JSON.parse(localStorage.getItem("morphazoid.graph-3d.v1") || "null");
    model.restore(value); traversal.clear(); observed = []; audio.silence(); selected = selectedEdge = 0;
    refreshGraph(); syncControls(); updateInspector(); nextPulse = now() + 0.025; status("Saved 3D graph recalled. Audio and Play unchanged.");
  } catch (e) { error(e); }
});

function syncView() {
  $("autoRotate").setAttribute("aria-pressed", String(view.auto));
  $("viewReadout").textContent = `${Math.round(view.yaw)}° / ${Math.round(view.pitch)}° · ${view.zoom.toFixed(1)}×`;
}
function syncControls() {
  for (const f of numberFields) {
    const value = model.settings[f.dataset.parameter];
    if (f.type === "checkbox") f.checked = value; else f.value = value;
    const output = $(`${f.id}Out`);
    if (output) output.value = `${Number(value).toFixed(Number(f.step) >= 1 ? 0 : Number(f.step) < 0.01 ? 3 : 2)}${f.dataset.unit || ""}`;
  }
  $("playButton").setAttribute("aria-pressed", String(playing));
  $("playButton").setAttribute("aria-label", playing ? "Pause graph" : "Play graph");
  $("playButton").title = playing ? "Pause graph" : "Play graph";
  const s = model.settings;
  const scene = Object.entries(GRAPH_3D_SCENES).find(([, values]) => Object.keys(values).every((k) => values[k] === s[k]));
  $("scene").value = scene?.[0] ?? "";
  $("sceneDescription").textContent = `${s.soundMode.toUpperCase()} · ${s.topology} / ${s.layout} · ${s.motion ? "live forces" : "held shape"} · ${s.baseDelay} ms minimum travel`;
  syncView();
}
function updateInspector(full = true) {
  if (full) {
    const sig = `${model.nodes.length}:${model.edges.map((e) => `${e.from}-${e.to}`).join(",")}`;
    if (sig !== routesSignature) {
      $("nodeSelect").replaceChildren(...model.nodes.map((n) => new Option(`Node ${n.id + 1}`, n.id)));
      $("routeSelect").replaceChildren(...model.edges.map((e, i) => new Option(`${e.from + 1} → ${e.to + 1}${e.feedbackEdge ? " · return" : ""}`, i)));
      routesSignature = sig;
    }
  }
  const n = graph.nodes[selected];
  $("nodeSelect").value = selected; $("routeSelect").value = selectedEdge;
  for (const axis of ["x", "y", "z"]) {
    const input = $(`node${axis.toUpperCase()}`);
    if (document.activeElement !== input) input.value = n[axis];
    $(`${input.id}Out`).value = n[axis].toFixed(2);
  }
  $("pinNode").setAttribute("aria-pressed", String(model.nodes[selected].pinned));
  $("pinNode").textContent = model.nodes[selected].pinned ? "Unpin node" : "Pin node";
  const edge = edgeMetrics[selectedEdge];
  $("routeSwitch").disabled = !edge;
  $("routeSwitch").setAttribute("aria-pressed", String(Boolean(edge?.enabled)));
  $("routeSwitch").textContent = edge?.enabled ? "Route on" : "Route off";
  $("routeReadout").textContent = edge ? `${edge.length.toFixed(2)} units · ${Math.round(edge.delaySeconds * 1000)} ms${edge.feedbackEdge ? " · feedback return" : ""}` : "No route";
  const s = model.settings, modulated = ["fm", "pm"].includes(s.soundMode);
  $("modulationIndex").disabled = !modulated;
  $("timbreSource").disabled = !modulated;
  $("strain").disabled = !modulated || s.timbreSource === "none";
  for (const [amount, source] of [["distanceRatio", "timeSource"], ["pitchRange", "mapping"], ["depthTone", "shadeSource"], ["spread", "panSource"]]) $(amount).disabled = s[source] === "none";
  const incoming = edgeMetrics.find((e) => e.to === selected && e.enabled);
  const preview = graph3DVoice({ nodeId: selected, amplitude: 1, feedbackCount: 0, length: incoming?.length ?? 0, strain: incoming?.strain ?? 0 }, graph, s);
  $("mappingReadout").textContent = `Node ${selected + 1}: ${Math.round(preview.frequency)} Hz${s.mapping === "bend" ? " (before bends)" : ""} · selected route: ${edge ? Math.round(edge.delaySeconds * 1000) : "—"} ms`;
  $("feedback").disabled = $("feedbackTone").disabled = !graph.cyclic;
  $("depthHint").textContent = model.settings.depth < 0.005 ? "Depth is flat. Raise Depth spread to edit the third axis." : "X/Y/Z are fixed-world coordinates, independent of the camera.";
  $("graphReadout").textContent = `${graph.nodes.length} nodes · ${graph.edges.length} routes · ${model.settings.motion ? "forces moving" : "forces held"}`;
}
function resize() {
  const box = $("stageWrap").getBoundingClientRect();
  width = Math.max(1, box.width); height = Math.max(1, box.height); dpr = Math.min(devicePixelRatio || 1, 1.5);
  canvas.width = Math.round(width * dpr); canvas.height = Math.round(height * dpr);
}
const observer = new ResizeObserver(resize); observer.observe($("stageWrap")); resize();
let projected = [], switches = [];
const screen = (p) => projectGraphPoint(p, view, width, height);
function line(a, b, color, thick = 1, dashed = false) {
  context.beginPath(); context.moveTo(a.x, a.y); context.lineTo(b.x, b.y);
  context.strokeStyle = color; context.lineWidth = thick; context.setLineDash(dashed ? [4, 5] : []); context.stroke(); context.setLineDash([]);
}
function dot(p, radius, fill, stroke, thick = 1) {
  context.beginPath(); context.arc(p.x, p.y, radius, 0, Math.PI * 2); context.fillStyle = fill; context.fill();
  if (stroke) { context.strokeStyle = stroke; context.lineWidth = thick; context.stroke(); }
}
function draw(time) {
  context.setTransform(dpr, 0, 0, dpr, 0, 0); context.fillStyle = "#070a0e"; context.fillRect(0, 0, width, height);
  for (let i = -1; i <= 1.001; i += 0.25) {
    line(screen({ x: i, y: -1, z: -1 }), screen({ x: i, y: -1, z: 1 }), "#18242c");
    line(screen({ x: -1, y: -1, z: i }), screen({ x: 1, y: -1, z: i }), "#18242c");
  }
  const origin = screen({ x: 0, y: -1, z: 0 });
  for (const [axis, color] of [["x", "#edb475"], ["y", "#7bd6b4"], ["z", "#a99bed"]]) {
    const p = { x: 0, y: -1, z: 0 }; p[axis] += 0.4;
    const end = screen(p); line(origin, end, color, 1.8);
    context.fillStyle = color; context.font = "10px ui-monospace, monospace"; context.fillText(axis.toUpperCase(), end.x + 4, end.y - 4);
  }
  projected = graph.nodes.map((n) => ({ ...screen(n), id: n.id }));
  const visibleEdges = graph.edges.map((e, i) => ({ ...e, index: i, depth: (projected[e.from].depth + projected[e.to].depth) / 2 })).sort((a, b) => a.depth - b.depth);
  switches = [];
  for (const e of visibleEdges) {
    const a = projected[e.from], b = projected[e.to];
    const alpha = clamp(0.5 + e.depth * 0.24, 0.2, 0.85);
    const color = e.enabled ? e.feedbackEdge ? `rgba(245,151,132,${alpha})` : `rgba(110,197,218,${alpha})` : "#27333c";
    line(a, b, color, e.index === selectedEdge ? 2.1 : 1.2, e.feedbackEdge || !e.enabled);
    const t = 0.66, p = { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
    const angle = Math.atan2(b.y - a.y, b.x - a.x);
    line(p, { x: p.x - 7 * Math.cos(angle - 0.5), y: p.y - 7 * Math.sin(angle - 0.5) }, color, 1.6);
    line(p, { x: p.x - 7 * Math.cos(angle + 0.5), y: p.y - 7 * Math.sin(angle + 0.5) }, color, 1.6);
    const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, edge: e.index };
    switches.push(mid);
    if (e.index === selectedEdge || !e.enabled) {
      dot(mid, 4, "#070a0e", e.enabled ? "#ffe3a6" : "#81909c", 1.3);
      if (!e.enabled) line({ x: mid.x - 3, y: mid.y + 3 }, { x: mid.x + 3, y: mid.y - 3 }, "#81909c");
    }
  }
  flashes.fill(0);
  for (const e of observed) {
    const age = time - e.time;
    if (age >= 0 && age < 0.35) flashes[e.nodeId] = Math.max(flashes[e.nodeId], 1 - age / 0.35);
    if (e.fromPoint && time >= e.departTime && time <= e.time) {
      const f = clamp((time - e.departTime) / Math.max(0.01, e.time - e.departTime));
      const p = { x: e.fromPoint.x + (e.toPoint.x - e.fromPoint.x) * f, y: e.fromPoint.y + (e.toPoint.y - e.fromPoint.y) * f, z: e.fromPoint.z + (e.toPoint.z - e.fromPoint.z) * f };
      dot(screen(p), 2.4, "#f4dfb3");
    }
  }
  for (const e of traversal.queue.slice(0, 80)) {
    if (!e.fromPoint || time < e.departTime || time > e.time) continue;
    const f = clamp((time - e.departTime) / Math.max(0.01, e.time - e.departTime));
    const p = { x: e.fromPoint.x + (e.toPoint.x - e.fromPoint.x) * f, y: e.fromPoint.y + (e.toPoint.y - e.fromPoint.y) * f, z: e.fromPoint.z + (e.toPoint.z - e.fromPoint.z) * f };
    dot(screen(p), 2.6, "#f4dfb3");
  }
  for (const p of [...projected].sort((a, b) => a.depth - b.depth)) {
    const color = colors[p.id % colors.length], radius = clamp(8 * p.scale, 5.5, 15);
    if (flashes[p.id] > 0) dot(p, radius + 6 * flashes[p.id], "#b9a2ed22", null);
    dot(p, radius, flashes[p.id] > 0.05 ? color : "#111a25", color, selected === p.id ? 2.5 : 1.2);
    if (model.nodes[p.id].pinned) { context.fillStyle = "#f7e3ba"; context.fillRect(p.x - 3, p.y - 3, 6, 6); }
    else { context.fillStyle = flashes[p.id] > 0.05 ? "#081018" : "#e5dfef"; context.font = "9px ui-monospace, monospace"; context.textAlign = "center"; context.fillText(p.id + 1, p.x, p.y + 3); }
    if (selected === p.id) dot(p, radius + 5, "transparent", "#f1ecd1", 1);
  }
  context.textAlign = "left";
}
function point(e) { const box = canvas.getBoundingClientRect(); return { x: e.clientX - box.left, y: e.clientY - box.top }; }
function pickNode(p) {
  return [...projected].filter((n) => Math.hypot(n.x - p.x, n.y - p.y) <= Math.max(16, n.scale * 13)).sort((a, b) => b.depth - a.depth)[0];
}
on(canvas, "pointerdown", (e) => {
  if (e.button !== 0 || drag || e.isPrimary === false) return;
  canvas.focus({ preventScroll: true });
  const p = point(e), hit = pickNode(p);
  if (hit) {
    selected = hit.id; drag = { id: e.pointerId, node: true, nodeId: selected, start: p, original: { ...graph.nodes[selected] }, local: { ...model.nodes[selected] }, depth: e.shiftKey || $("editDepth").checked, moved: false };
    model.nodes[selected].pinned = true; refreshGraph(); updateInspector();
  } else {
    const route = switches.filter((s) => Math.hypot(s.x - p.x, s.y - p.y) < 12).sort((a, b) => Math.hypot(a.x - p.x, a.y - p.y) - Math.hypot(b.x - p.x, b.y - p.y))[0];
    drag = { id: e.pointerId, node: false, start: p, yaw: view.yaw, pitch: view.pitch, edge: route?.edge };
  }
  canvas.setPointerCapture(e.pointerId); canvas.classList.add("is-dragging"); e.preventDefault();
});
on(canvas, "pointermove", (e) => {
  if (!drag || drag.id !== e.pointerId) return;
  const p = point(e), dx = p.x - drag.start.x, dy = p.y - drag.start.y;
  if (drag.node) {
    if (Math.hypot(dx, dy) > 3) drag.moved = true;
    if (drag.moved) {
      model.setWorldPoint(drag.nodeId, dragGraphPoint(drag.original, dx, dy, view, width, height, drag.depth)); refreshGraph(); updateInspector(false);
    }
  } else if (Math.hypot(dx, dy) > 3) {
    view.yaw = (drag.yaw + dx * 0.4) % 360; view.pitch = clamp(drag.pitch + dy * 0.35, -85, 85); view.auto = false; syncView();
  }
  e.preventDefault();
});
function finish(e, cancel = false) {
  if (!drag || drag.id !== e.pointerId) return;
  const saved = drag; drag = null;
  if (saved.node) {
    if (cancel || !saved.moved) Object.assign(model.nodes[saved.nodeId], saved.local);
    refreshGraph();
  } else if (!cancel && saved.edge !== undefined && Math.hypot(point(e).x - saved.start.x, point(e).y - saved.start.y) < 4) { selectedEdge = saved.edge; toggleEdge(); }
  if (canvas.hasPointerCapture(e.pointerId)) canvas.releasePointerCapture(e.pointerId);
  canvas.classList.remove("is-dragging"); updateInspector();
}
on(canvas, "pointerup", (e) => finish(e));
on(canvas, "pointercancel", (e) => finish(e, true));
on(canvas, "lostpointercapture", (e) => { if (drag?.id === e.pointerId) finish(e, true); });
on(canvas, "wheel", (e) => { view.zoom = clamp(view.zoom * Math.exp(-e.deltaY * 0.001), 0.5, 1.9); syncView(); e.preventDefault(); }, { passive: false });
on(canvas, "keydown", (e) => {
  if (e.ctrlKey || e.metaKey || e.altKey || drag) return;
  if (e.key === "[") { selected = (selected + model.nodes.length - 1) % model.nodes.length; updateInspector(); e.preventDefault(); }
  if (e.key === "]") { selected = (selected + 1) % model.nodes.length; updateInspector(); e.preventDefault(); }
  if (e.key === "Enter") { sendNote(); e.preventDefault(); }
  if (e.key.toLowerCase() === "p") { model.nodes[selected].pinned = !model.nodes[selected].pinned; refreshGraph(); updateInspector(); e.preventDefault(); }
  if (e.key.startsWith("Arrow")) {
    const dx = e.key === "ArrowRight" ? 10 : e.key === "ArrowLeft" ? -10 : 0;
    const dy = e.key === "ArrowDown" ? 10 : e.key === "ArrowUp" ? -10 : 0;
    if (e.shiftKey) {
      model.setWorldPoint(selected, dragGraphPoint(graph.nodes[selected], dx, dy, view, width, height, $("editDepth").checked)); refreshGraph(); updateInspector();
    } else { view.yaw = (view.yaw + dx) % 360; view.pitch = clamp(view.pitch + dy, -85, 85); view.auto = false; syncView(); }
    e.preventDefault();
  }
});
on(window, "morphazoid:midi-input", (e) => {
  if (document.hidden) return;
  const m = e.detail?.message ?? e.detail;
  if (m?.type === "noteOn") { sendNote(selected, Math.round(clamp(m.note, 0, 127, 68)), clamp(m.velocity / 127, 0.04, 1, 0.85)); e.preventDefault(); }
});
function frame(time) {
  if (disposed) return;
  const dt = Math.min(0.05, Math.max(0, (time - lastRotation) / 1000)); lastRotation = time;
  if (view.auto && !drag && !document.hidden) { view.yaw = (view.yaw + dt * 9) % 360; syncView(); }
  if (!document.hidden && time - lastPaint > 33) {
    lastPaint = time; const clock = now(); draw(playing || manualUntil > clock ? clock : pauseAt);
    canvas.dataset.state = JSON.stringify({ playing, audio: armed, camera: view, selected, selectedEdge,
      arrivals: traversal.arrivals, pending: traversal.queue.length, settings: model.settings,
      nodes: graph.nodes, edges: graph.edges.map(({ from, to, enabled }) => ({ from, to, enabled })),
      projected: projected.map(({ x, y, id }) => ({ x, y, id })) });
  }
  frameId = requestAnimationFrame(frame);
}
function suspend() {
  if (drag) finish({ pointerId: drag.id }, true);
  generation++; armed = false; starting = false; setPlaying(false); traversal.clear(); observed = []; manualUntil = 0;
  audio.setOutput(0); void audio.close(); strip.setAudioState("off"); status("Paused with Audio off.");
}
on(document, "visibilitychange", () => {
  if (document.hidden) { suspend(); clearInterval(timer); timer = null; }
  else if (!disposed) { lastTick = now(); forceAccumulator = 0; timer ??= setInterval(tick, 20); }
});
on(window, "pagehide", (e) => {
  suspend(); clearInterval(timer); timer = null; cancelAnimationFrame(frameId);
  if (!e.persisted) { disposed = true; observer.disconnect(); abort.abort(); strip.destroy(); }
});
on(window, "pageshow", (e) => {
  if (disposed) return;
  lastTick = now(); lastRotation = performance.now();
  if (e.persisted) { timer ??= setInterval(tick, 20); frameId = requestAnimationFrame(frame); }
});
on($("infoButton"), "click", () => $("infoDialog").showModal());
on($("infoDialog"), "close", () => $("infoButton").focus({ preventScroll: true }));
refreshGraph(); syncControls(); updateInspector();
timer = setInterval(tick, 20); frameId = requestAnimationFrame(frame);

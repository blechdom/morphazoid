import { GraphRenderer, regionHandlePixels } from "./renderer.js";
import { buildGeometry, nearestPoint } from "./geometry.js";
import { MAX_HEADS, collectContacts, crossedAxes, fitRegion, headOffsets, headPhase, readerRegion, regionCenter } from "./readers.js";
import { updateHeadOffset } from "../../playheads.js";
import { rebaseContinuousPosition, rebasePingPongPosition } from "../../articulation.js";
import { formatCoordinate, homeView, panView, squareView, zoomView } from "./camera.js";
import { TraceAudio, traceVoiceTargets } from "./audio.js";
import { DRUM_COUNT, DRUM_PITCH, DRUM_PLACEMENTS, PitchedPercussion, TRIGGER_VOICE_GROUPS, crossedTriggers, isPitchedVoice, pitchedTriggerFrequency, rowTriggers, triggerVoice } from "./triggers.js";
import { VOICES } from "./audio.js";
import { enhanceRangeKnob } from "../../ui/primitives/range-knob.js";
import { FmDrumAudio } from "../fm-drums/fm-drums.js";
import {
  COLORS, DEFAULT_PRESET_ID, DEFAULT_RANGE, PRESETS, SLIDER_DEFAULTS, SWEEP_TEMPO, addRow, addSliders, advanceSliders, analyzeState, applySnapshot,
  ensureSliders, randomizeState, removeRow, sanitizeRange, sanitizeSettings, sanitizeSlider, sanitizeView, setParameterValue, snapshotOf, sweepSecondsFromTempo, sweepTempoFromSeconds, updateRow,
} from "./model.js";
import { formatParameterValue } from "./expressions.js";
import { formatNumber } from "./parser.js";
import { createAudioStrip } from "../../ui/patterns/audio-strip.js";
import { registerHeaderPresets } from "../../site/header-presets.js";

const STORAGE_KEY = "morphazoid.graphonic-calculator.v1";
const PLAYBACK_LABELS = Object.freeze({ points: "Points", line: "Line", radar: "Radar" });
const VOICE_LABELS = Object.freeze({ sine: "Sine", triangle: "Triangle", reed: "Reed", saw: "Saw", pulse: "Pulse", fm: "FM" });
const HEAD_COLORS = Object.freeze(["#69f2bd", "#78a7ff", "#cb8fff", "#e8c46b"]);
const clamp01 = (value) => Math.min(0.9999, Math.max(0, Number(value) || 0));
const PLAYBACK_NOTES = Object.freeze({
  points: "Heads travel along every curve at the same pace and sound where they are.",
  line: "A line sweeps the view; every curve it crosses sounds.",
  radar: "A ray turns about the play region's centre (the origin when following the view); every curve it crosses sounds.",
});
const PLACEMENT_LABELS = Object.freeze({ x: "X grid", y: "Y grid", xy: "X + Y grid", equidistant: "Equidistant on curve" });
const PLOTTABLE_KINDS = new Set(["explicit-y", "explicit-x", "implicit", "polar", "parametric", "function"]);
const KIND_LABELS = Object.freeze({
  "explicit-y": "y as a function of x", "explicit-x": "x as a function of y", implicit: "implicit curve", polar: "polar curve",
  parametric: "parametric curve", point: "point", inequality: "shaded region", function: "function", value: "value",
});
const $ = (id) => document.getElementById(id);
const abort = new AbortController();
const listen = (node, type, handler, options = {}) => node.addEventListener(type, handler, { ...options, signal: abort.signal });
const canvas = $("stage");
const stageWrap = $("stageWrap");
const renderer = new GraphRenderer(canvas);

let state = loadInitialState();
let analysis = analyzeState(state);
let geometry = [];
let geometryDirty = true;
let playing = false, armed = false, starting = false, disposed = false, ready = false;
let sweepAnchor = { time: 0, travel: 0, source: "frame" };
let reading = null, previousHeads = null, triggers = [], triggersDirty = true, drumHits = 0;
const hitTimes = new Map();
let hover = null, selectedId = null, drag = null;
let frameId = 0, lastFrameTime = 0, saveTimer = 0, positionDragging = false;
let level = 0.5;
const display = { grid: true, labels: true };
const pointers = new Map();
const sliderDirections = new Map();

const audio = new TraceAudio({ onError(error) { armed = false; strip.setAudioState("error"); showAudioError(error.message); } });
const drums = new FmDrumAudio(globalThis);
let percussion = null;
const strip = createAudioStrip({ buttonId: "audioButton", levelId: "level", level, max: 1, onAudioClick: toggleAudio, onLevelInput(value) { level = value; audio.setLevel(value); drums.setHostGain(value); } });
$("audioHost").replaceWith(strip);
audio.setLevel(level);
drums.setOutput(0.72);
drums.setHostGain(level);

function loadInitialState() {
  const fallback = () => applySnapshot(PRESETS.find((preset) => preset.id === DEFAULT_PRESET_ID).snapshot);
  try {
    const raw = globalThis.localStorage?.getItem(STORAGE_KEY);
    if (!raw) return fallback();
    const saved = JSON.parse(raw);
    if (saved?.version !== 1 || !saved.snapshot) return fallback();
    if (saved.display) { display.grid = saved.display.grid !== false; display.labels = saved.display.labels !== false; }
    return applySnapshot(saved.snapshot);
  } catch {
    return fallback();
  }
}

function saveSoon() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try { globalThis.localStorage?.setItem(STORAGE_KEY, JSON.stringify({ version: 1, snapshot: snapshotOf(state), display })); } catch { /* storage unavailable */ }
  }, 400);
}

function status(message) { $("sessionStatus").textContent = message; }
function announce(message) { $("liveStatus").textContent = message; }
function showAudioError(message) { const node = $("audioError"); node.textContent = message; node.hidden = !message; }

function setState(next, { rebuild = true } = {}) {
  if (next === state) return;
  state = next;
  analysis = analyzeState(state);
  const withSliders = ensureSliders(state, analysis);
  if (withSliders !== state) { state = withSliders; analysis = analyzeState(state); }
  if (rebuild) geometryDirty = true;
  triggersDirty = true;
  renderRows();
  syncSettings();
  presets?.refresh();
  saveSoon();
  requestFrame();
}

function setView(view) {
  setState({ ...state, view: sanitizeView(view) });
}

function viewSize() {
  return { width: renderer.width, height: renderer.height };
}

function clockNow() {
  const time = audio.armed && audio.currentTime !== null ? audio.currentTime : performance.now() / 1000;
  const source = audio.armed ? "audio" : "frame";
  if (source !== sweepAnchor.source) sweepAnchor = { time, travel: currentTravel(sweepAnchor.source === "audio" && audio.currentTime !== null ? audio.currentTime : performance.now() / 1000), source };
  return time;
}

// Unwrapped, signed travel in cycles: readers fold it per head, so direction and motion changes never jump.
function currentTravel(time) {
  if (!playing) return sweepAnchor.travel;
  const elapsed = Math.max(0, time - sweepAnchor.time);
  return sweepAnchor.travel + ((state.settings.direction < 0 ? -1 : 1) * elapsed) / state.settings.sweepSeconds;
}

function reanchor() {
  const time = clockNow();
  sweepAnchor = { time, travel: currentTravel(time), source: sweepAnchor.source };
}

function setSettings(patch, { retime = false } = {}) {
  if (retime) reanchor();
  setState({ ...state, settings: sanitizeSettings({ ...state.settings, ...patch }) }, { rebuild: false });
}

function setTravel(travel) {
  sweepAnchor = { ...sweepAnchor, time: clockNow(), travel };
  requestFrame();
}

/** Move the first playhead to a physical position without discarding completed cycles. */
function scrubPosition(position) {
  const travel = currentTravel(clockNow());
  const next = state.settings.motion === "pingpong" ? rebasePingPongPosition(travel, position) : rebaseContinuousPosition(travel, headPhase(travel, 0, "loop"), position);
  setTravel(next);
}

function formatPosition(phase) {
  return state.settings.playback === "radar" ? `${Math.round(phase * 360)}°` : `${(phase * 100).toFixed(1)}%`;
}

function syncPosition(travel) {
  const phase = headPhase(travel, 0, state.settings.motion);
  const input = $("position");
  if (document.activeElement !== input && !positionDragging) input.value = String(phase);
  input.setAttribute("aria-valuetext", formatPosition(phase));
  $("positionOut").value = formatPosition(phase);
}

function buildTriggers(roles) {
  const list = [];
  for (const item of geometry) {
    const row = roles.get(item.id);
    if (row?.role !== "drums" || item.kind === "point") continue;
    for (const trigger of rowTriggers(item, row.drum, state.settings, state.view)) list.push({ ...trigger, rowId: row.id, color: item.color, drum: row.drum });
  }
  return list;
}

function fireTriggers(heads, roles) {
  if (!playing) { previousHeads = heads; return; }
  const fired = crossedTriggers(triggers, state.settings, state.view, previousHeads, heads);
  previousHeads = heads;
  if (!fired.length) return;
  const now = performance.now() / 1000;
  const sounded = new Set();
  for (const { trigger } of fired) {
    hitTimes.set(trigger.id, now);
    drumHits++;
    if (!armed || sounded.has(trigger.rowId + trigger.index)) continue;
    sounded.add(trigger.rowId + trigger.index);
    if (isPitchedVoice(trigger.drum.voice)) {
      if (!percussion) continue;
      const region = reading.region;
      const pan = ((trigger.x - region.xMin) / (region.xMax - region.xMin)) * 2 - 1;
      const kind = TRIGGER_VOICE_GROUPS[0].voices.find((voice) => voice.id === trigger.drum.voice)?.kind ?? "pluck";
      percussion.trigger(kind, pitchedTriggerFrequency(trigger, state.settings, state.view), { pan, level: 0.45 });
    } else drums.trigger(triggerVoice(trigger.drum, trigger, state.settings, state.view)).catch(() => {});
  }
  if (hitTimes.size > 512) for (const [id, time] of hitTimes) if (now - time > 1) hitTimes.delete(id);
}

function regionOverlay() {
  return { rect: readerRegion(state.settings, state.view), center: regionCenter(state.settings, state.view), active: Boolean(state.settings.region) };
}

const REGION_HANDLES = Object.freeze([
  { x: "min", y: "max" }, { x: "max", y: "max" }, { x: "min", y: "min" }, { x: "max", y: "min" },
  { x: null, y: "max" }, { x: null, y: "min" }, { x: "min", y: null }, { x: "max", y: null },
]);

/** The region handle (resize edges or the move centre) under a pixel, or null. */
function regionHandleAt(px, py, radius = 11) {
  if (!state.settings.region) return null;
  const camera = renderer.camera(state.view);
  const rect = state.settings.region;
  const [left, top] = camera.toPixel(rect.xMin, rect.yMax);
  const [right, bottom] = camera.toPixel(rect.xMax, rect.yMin);
  const handles = regionHandlePixels({ left, top, right, bottom });
  let best = null;
  handles.forEach(([hx, hy], index) => {
    const distance = Math.hypot(hx - px, hy - py);
    if (distance <= radius && (!best || distance < best.distance)) best = { distance, edges: REGION_HANDLES[index] };
  });
  if (best) return { kind: "resize", edges: best.edges };
  const center = regionCenter(state.settings, state.view);
  const [cx, cy] = camera.toPixel(center.x, center.y);
  if (Math.hypot(cx - px, cy - py) <= radius + 2) return { kind: "move" };
  return null;
}

function setRegion(region) {
  setSettings({ region });
}

function regionLabel(settings) {
  if (!settings.region) return "follows the view";
  const { xMin, xMax, yMin, yMax } = settings.region;
  return `x ${formatCoordinate(xMin)} to ${formatCoordinate(xMax)} · y ${formatCoordinate(yMin)} to ${formatCoordinate(yMax)}`;
}

function setHeads(count) {
  const heads = Math.min(MAX_HEADS, Math.max(1, Math.round(count)));
  if (heads === state.settings.heads) return;
  setSettings({ heads, headOffsets: undefined }, { retime: true });
}

function setHeadOffset(index, value) {
  setSettings({ headOffsets: updateHeadOffset(headOffsets(state.settings), index, clamp01(value)) });
}

function toggleHeadOption(index) {
  const { settings } = state;
  if (settings.playback === "line") {
    const axes = [...settings.headAxes];
    axes[index] = axes[index] === "horizontal" ? "vertical" : "horizontal";
    setSettings({ headAxes: axes });
  } else {
    const directions = [...settings.headDirections];
    directions[index] = directions[index] < 0 ? 1 : -1;
    setSettings({ headDirections: directions }, { retime: true });
  }
}

function setPlaying(value) {
  if (playing === value) return;
  reanchor();
  playing = value;
  const button = $("playButton");
  button.setAttribute("aria-pressed", String(value));
  button.setAttribute("aria-label", value ? "Pause the reader" : "Play the reader");
  if (!value) audio.silence();
  status(value ? (armed ? "Playing · every curve the reader meets sounds." : "Playing silently · enable Audio to hear the curves.") : "Paused · the reader holds its place.");
  announce(value ? "Reader playing" : "Reader paused");
  requestFrame();
}

async function toggleAudio() {
  showAudioError("");
  if (armed || starting) {
    starting = false; armed = false;
    strip.setAudioState("off");
    percussion = null;
    await Promise.all([audio.stop(), drums.close()]);
    if (!disposed) status(playing ? "Audio off · the sweep continues silently." : "Audio off.");
    return;
  }
  starting = true;
  strip.setAudioState("starting");
  try {
    await audio.start();
    if (disposed) return;
    audio.setLevel(level);
    await drums.start({ context: audio.context });
    drums.setHostGain(level);
    percussion = new PitchedPercussion(audio.context, audio.master);
    armed = true;
    strip.setAudioState("on");
    status(playing ? "Audio on · the playhead reads every visible curve." : "Audio on · press Play to sweep the view.");
  } catch (error) {
    if (disposed) return;
    strip.setAudioState("error");
    showAudioError(error.message);
  } finally {
    starting = false;
  }
  requestFrame();
}

function requestFrame() {
  if (disposed || frameId) return;
  frameId = requestAnimationFrame(frame);
}

function frame(timestamp) {
  frameId = 0;
  if (disposed) return;
  const delta = lastFrameTime ? Math.min(0.1, (timestamp - lastFrameTime) / 1000) : 0;
  lastFrameTime = timestamp;
  const animating = state.rows.some((row) => row.slider?.animating);
  if (animating && delta > 0) {
    const advanced = advanceSliders(state, analysis, delta, sliderDirections);
    if (advanced !== state) { state = advanced; analysis = analyzeState(state); geometryDirty = true; renderRows(); presets?.refresh(); saveSoon(); }
  }
  const { width, height } = viewSize();
  if (geometryDirty) { geometry = buildGeometry(analysis, state, state.view, width, height); geometryDirty = false; }
  const travel = currentTravel(clockNow());
  const roles = new Map(state.rows.map((row) => [row.id, row]));
  reading = collectContacts(geometry.filter((item) => roles.get(item.id)?.role !== "drums"), state.settings, state.view, travel);
  if (triggersDirty) { triggers = buildTriggers(roles); triggersDirty = false; }
  fireTriggers(reading.heads, roles);
  syncPosition(travel);
  if (armed && playing) audio.update(traceVoiceTargets(reading.contacts, { view: reading.region, center: reading.center, octaves: state.settings.traceOctaves, source: state.settings.pitchSource }));
  const now = performance.now() / 1000;
  renderer.draw({ view: state.view, geometry, grid: display.grid, labels: display.labels, reading, hover, selectedId, region: regionOverlay(), triggers: triggers.map((trigger) => ({ x: trigger.x, y: trigger.y, color: trigger.color, hit: hitTimes.has(trigger.id) ? now - hitTimes.get(trigger.id) : null })) });
  if (hitTimes.size && [...hitTimes.values()].some((time) => now - time < 0.3)) requestFrame();
  ready = true;
  canvas.dataset.ready = "true";
  if (playing || animating) requestFrame();
  else lastFrameTime = 0;
}

function resize() {
  const bounds = stageWrap.getBoundingClientRect();
  renderer.resize(bounds.width || 1, bounds.height || 1, globalThis.devicePixelRatio || 1);
  geometryDirty = true;
  requestFrame();
}

const observer = globalThis.ResizeObserver ? new ResizeObserver(resize) : null;
observer?.observe(stageWrap);
resize();

const presets = registerHeaderPresets({
  id: "graphonic-calculator",
  presets: PRESETS,
  host: $("mainPresets"),
  capture: () => snapshotOf(state),
  apply(snapshot) {
    sliderDirections.clear();
    setState(applySnapshot(snapshot));
    announce("Preset applied");
  },
  randomize: (snapshot, random) => randomizeState(snapshot, random),
});

function rowIndex(id) { return state.rows.findIndex((row) => row.id === id); }
function rowInfo(id) { const index = rowIndex(id); return index < 0 ? null : analysis.rows[index]; }

function createRowElement(row) {
  const item = document.createElement("li");
  item.className = "expression-row";
  item.dataset.rowId = row.id;
  item.innerHTML = `
    <button class="expression-swatch" type="button" aria-pressed="true"></button>
    <input class="expression-input" type="text" autocomplete="off" autocapitalize="off" spellcheck="false" />
    <div class="expression-status"></div>
    <div class="expression-actions"><button class="row-color" type="button" title="Next color">◐</button><button class="row-delete" type="button" title="Delete">×</button></div>
    <div class="expression-extra"></div>`;
  return item;
}

function updateRowElement(item, row, info, index) {
  const number = index + 1;
  item.style.setProperty("--row-color", row.color);
  item.classList.toggle("is-selected", row.id === selectedId);
  item.classList.toggle("has-error", info.kind === "error" || Boolean(info.error));
  const swatch = item.querySelector(".expression-swatch");
  swatch.setAttribute("aria-pressed", String(row.visible));
  swatch.setAttribute("aria-label", `${row.visible ? "Hide" : "Show"} expression ${number}`);
  const input = item.querySelector(".expression-input");
  input.setAttribute("aria-label", `Expression ${number}`);
  if (document.activeElement !== input && input.value !== row.text) input.value = row.text;
  item.querySelector(".row-color").setAttribute("aria-label", `Change color of expression ${number}`);
  item.classList.toggle("is-drums", row.role === "drums");
  item.querySelector(".row-delete").setAttribute("aria-label", `Delete expression ${number}`);
  renderStatus(item.querySelector(".expression-status"), row, info);
  renderExtra(item.querySelector(".expression-extra"), row, info, number);
}

function statusContent(info) {
  if (info.error) {
    const missing = info.missing ?? [];
    return { text: missing.length ? `Undefined: ${missing.join(", ")}` : info.error, sliders: missing };
  }
  if (info.kind === "value" || (info.kind === "parameter" && !info.definition?.slider)) return { text: `= ${formatNumber(info.value)}`, sliders: [] };
  if (info.kind === "function") return { text: `${info.definition.name}(${info.definition.params.join(", ")}) defined${info.plot ? " · drawn as y" : ""}`, sliders: [] };
  if (info.kind === "parameter" || info.kind === "empty") return { text: "", sliders: [] };
  return { text: KIND_LABELS[info.kind] ?? "", sliders: [] };
}

// Rebuilding identical status DOM would detach a button between pointerdown and click.
function renderStatus(node, row, info) {
  node.classList.toggle("is-error", Boolean(info.error));
  const { text, sliders } = statusContent(info);
  const signature = JSON.stringify([text, sliders]);
  if (node.dataset.signature === signature) return;
  node.dataset.signature = signature;
  node.replaceChildren();
  if (text) { const span = document.createElement("span"); span.textContent = text; node.append(span); }
  if (sliders.length) {
    const button = document.createElement("button");
    button.type = "button";
    button.dataset.addSliders = sliders.join(",");
    button.textContent = sliders.length === 1 ? `Add slider: ${sliders[0]}` : `Add sliders: ${sliders.join(", ")}`;
    node.append(button);
  }
}

function renderExtra(node, row, info, number) {
  const name = info.definition?.name ?? "";
  const extra = info.kind === "parameter" && row.slider ? "slider" : info.kind === "polar" || info.kind === "parametric" ? "range" : "none";
  const tools = PLOTTABLE_KINDS.has(info.kind) && info.plot ? row.role : "none";
  const kind = `${extra}/${tools}`;
  if (node.dataset.kind !== kind) {
    node.dataset.kind = kind;
    node.replaceChildren();
    if (extra === "slider") {
      node.innerHTML = `<div class="expression-slider"><input class="slider-min" type="number" step="any" /><input class="slider-value" type="range" /><input class="slider-max" type="number" step="any" /><button class="slider-play" type="button" aria-pressed="false">▶</button></div>
        <div class="expression-slider-options" hidden><select class="slider-mode"><option value="bounce">Bounce</option><option value="loop">Loop</option><option value="once">Play once</option></select><select class="slider-speed"><option value="0.25">¼×</option><option value="0.5">½×</option><option value="1">1×</option><option value="2">2×</option><option value="4">4×</option></select></div>`;
    } else if (extra === "range") {
      node.innerHTML = `<div class="expression-range"><span class="range-label"></span><input class="range-low" type="number" step="any" /><span>to</span><input class="range-high" type="number" step="any" /></div>`;
    }
    if (tools !== "none") {
      const block = document.createElement("div");
      block.className = "layer-tools";
      const voiceOptions = TRIGGER_VOICE_GROUPS.map((group) => `<optgroup label="${group.label}">${group.voices.map((voice) => `<option value="${voice.id}">${voice.name}</option>`).join("")}</optgroup>`).join("");
      block.innerHTML = tools === "drums"
        ? `<div class="layer-hits">
            <div class="layer-field layer-count"><span class="field-label">Count</span><label class="layer-knob mz-range-knob"><input class="drum-count" type="range" min="${DRUM_COUNT.min}" max="${DRUM_COUNT.max}" step="1" /></label><output class="drum-count-out"></output></div>
            <label class="layer-field"><span class="field-label">Placement</span><select class="drum-placement">${DRUM_PLACEMENTS.map((placement) => `<option value="${placement}">${PLACEMENT_LABELS[placement]}</option>`).join("")}</select></label>
            <label class="layer-field"><span class="field-label">Voice</span><select class="drum-voice">${voiceOptions}</select></label>
            <label class="layer-field layer-pitch"><span class="field-label">Pitch ± st</span><input class="drum-pitch" type="number" min="${DRUM_PITCH.min}" max="${DRUM_PITCH.max}" step="1" /></label>
          </div>
          <div class="layer-mode choice-switch" role="group" aria-label="How expression ${number} sounds"><button type="button" data-role="contour" aria-pressed="false">∿ Wave</button><button type="button" data-role="drums" aria-pressed="true">♩ Hits</button></div>`
        : `<div class="layer-wave">
            <label class="layer-field"><span class="field-label">Synthesis</span><select class="layer-voice"><option value="">Shared voice</option>${VOICES.map((voice) => `<option value="${voice}">${VOICE_LABELS[voice]}</option>`).join("")}</select></label>
          </div>
          <div class="layer-mode choice-switch" role="group" aria-label="How expression ${number} sounds"><button type="button" data-role="contour" aria-pressed="true">∿ Wave</button><button type="button" data-role="drums" aria-pressed="false">♩ Hits</button></div>`;
      node.append(block);
      const knob = block.querySelector(".drum-count");
      if (knob) enhanceRangeKnob(knob);
    }
  }
  if (extra === "slider") {
    const { min, max, step, animating } = row.slider;
    const range = node.querySelector(".slider-value"), low = node.querySelector(".slider-min"), high = node.querySelector(".slider-max"), play = node.querySelector(".slider-play");
    range.min = String(min); range.max = String(max); range.step = String(step || (max - min) / 1000);
    range.setAttribute("aria-label", `${name} value`);
    const value = Number.isFinite(info.value) ? Math.min(max, Math.max(min, info.value)) : min;
    if (document.activeElement !== range) range.value = String(value);
    range.setAttribute("aria-valuetext", formatParameterValue(info.value));
    if (document.activeElement !== low) low.value = formatParameterValue(min);
    if (document.activeElement !== high) high.value = formatParameterValue(max);
    low.setAttribute("aria-label", `${name} minimum`); high.setAttribute("aria-label", `${name} maximum`);
    play.setAttribute("aria-pressed", String(animating));
    play.setAttribute("aria-label", `${animating ? "Stop animating" : "Animate"} ${name}`);
    play.textContent = animating ? "❚❚" : "▶";
    const { mode, speed } = row.slider;
    const options = node.querySelector(".expression-slider-options");
    options.hidden = !(animating || mode !== SLIDER_DEFAULTS.mode || speed !== SLIDER_DEFAULTS.speed);
    const modeSelect = node.querySelector(".slider-mode"), speedSelect = node.querySelector(".slider-speed");
    modeSelect.setAttribute("aria-label", `${name} animation mode`); speedSelect.setAttribute("aria-label", `${name} animation speed`);
    if (document.activeElement !== modeSelect) modeSelect.value = mode;
    if (document.activeElement !== speedSelect) speedSelect.value = String(speed);
  } else if (extra === "range") {
    const [from, to] = row.range ?? DEFAULT_RANGE;
    const variable = info.kind === "polar" ? "θ" : "t";
    node.querySelector(".range-label").textContent = `${variable} from`;
    const low = node.querySelector(".range-low"), high = node.querySelector(".range-high");
    if (document.activeElement !== low) low.value = formatParameterValue(from);
    if (document.activeElement !== high) high.value = formatParameterValue(to);
    low.setAttribute("aria-label", `${variable} start for expression ${number}`); high.setAttribute("aria-label", `${variable} end for expression ${number}`);
  }
  if (tools === "drums") {
    const { placement, count, voice, pitch } = row.drum;
    const placementSelect = node.querySelector(".drum-placement"), countInput = node.querySelector(".drum-count"), voiceSelect = node.querySelector(".drum-voice"), pitchInput = node.querySelector(".drum-pitch");
    placementSelect.setAttribute("aria-label", `Trigger placement for expression ${number}`); countInput.setAttribute("aria-label", `Trigger count for expression ${number}`);
    voiceSelect.setAttribute("aria-label", `Strike voice for expression ${number}`); pitchInput.setAttribute("aria-label", `Pitch bend range in semitones for expression ${number}`);
    if (document.activeElement !== placementSelect) placementSelect.value = placement;
    if (document.activeElement !== countInput) countInput.value = String(count);
    countInput.setAttribute("aria-valuetext", `${count} ${placement === "equidistant" ? "per branch" : "subdivisions"}`);
    node.querySelector(".drum-count-out").value = String(count);
    if (document.activeElement !== voiceSelect) voiceSelect.value = voice;
    if (document.activeElement !== pitchInput) pitchInput.value = String(pitch);
    node.querySelector(".layer-pitch").hidden = isPitchedVoice(voice);
  } else if (tools === "contour") {
    const voiceSelect = node.querySelector(".layer-voice");
    voiceSelect.setAttribute("aria-label", `Synthesis for expression ${number}`);
    if (document.activeElement !== voiceSelect) voiceSelect.value = row.voice ?? "";
  }
}

function renderRows() {
  const list = $("expressionList");
  const existing = new Map([...list.children].map((node) => [node.dataset.rowId, node]));
  state.rows.forEach((row, index) => {
    let item = existing.get(row.id);
    if (!item) item = createRowElement(row);
    existing.delete(row.id);
    updateRowElement(item, row, analysis.rows[index], index);
    if (list.children[index] !== item) list.insertBefore(item, list.children[index] ?? null);
  });
  for (const stale of existing.values()) stale.remove();
}

function syncSettings() {
  const { view, settings } = state;
  for (const [id, value] of [["viewXMin", view.xMin], ["viewXMax", view.xMax], ["viewYMin", view.yMin], ["viewYMax", view.yMax]]) {
    const input = $(id);
    if (document.activeElement !== input) input.value = formatParameterValue(value);
  }
  for (const button of $("angleMode").querySelectorAll("button")) button.setAttribute("aria-pressed", String(button.dataset.angle === settings.angle));
  $("viewSummary").textContent = settings.angle;
  const tempo = sweepTempoFromSeconds(settings.sweepSeconds);
  if (document.activeElement !== $("sweepTempo")) $("sweepTempo").value = String(Math.min(SWEEP_TEMPO.max, Math.max(SWEEP_TEMPO.min, tempo)));
  $("sweepTempoOut").textContent = `${formatParameterValue(Number(tempo.toFixed(1)))} /min · ${settings.sweepSeconds.toFixed(1)} s`;
  if (document.activeElement !== $("traceOctaves")) $("traceOctaves").value = String(settings.traceOctaves);
  $("traceOctavesOut").textContent = `${settings.traceOctaves.toFixed(1)} oct`;
  for (const button of $("playbackMode").querySelectorAll("button")) button.setAttribute("aria-pressed", String(button.dataset.playback === settings.playback));
  for (const button of $("playheadMotion").querySelectorAll("button[data-motion]")) button.setAttribute("aria-pressed", String(button.dataset.motion === settings.motion));
  const reversed = settings.direction < 0;
  const direction = $("directionToggle");
  direction.setAttribute("aria-pressed", String(reversed));
  direction.setAttribute("aria-label", `Playhead direction: ${reversed ? "reverse" : "forward"}`);
  $("directionGlyph").textContent = reversed ? "←" : "→";
  $("directionText").textContent = reversed ? "Reverse" : "Forward";
  $("positionLabel").textContent = settings.playback === "radar" ? "Ray angle" : "Playhead position";
  $("headCountOut").textContent = String(settings.heads);
  $("heads").value = String(settings.heads);
  $("headsOut").value = `${settings.heads} ${settings.heads === 1 ? "playhead" : "playheads"}`;
  $("playheadStepper").setAttribute("aria-label", `${settings.heads} ${settings.heads === 1 ? "playhead" : "playheads"}`);
  $("removeHead").disabled = settings.heads <= 1;
  $("addHead").disabled = settings.heads >= MAX_HEADS;
  $("resetHeadSpacing").disabled = settings.heads <= 1;
  $("crossHeadAxes").hidden = settings.playback !== "line";
  $("crossHeadAxes").disabled = settings.heads <= 1;
  syncHeadTrack();
  if (document.activeElement !== $("pitchSource")) $("pitchSource").value = settings.pitchSource;
  if (document.activeElement !== $("voice")) $("voice").value = settings.voice;
  if (document.activeElement !== $("timbre")) $("timbre").value = String(settings.timbre);
  $("timbreOut").textContent = `${Math.round(settings.timbre * 100)}%`;
  if (document.activeElement !== $("glide")) $("glide").value = String(settings.glide);
  $("glideOut").textContent = `${Math.round(settings.glide * 1000)} ms`;
  $("soundSummary").textContent = `${VOICE_LABELS[settings.voice]} · ${settings.pitchSource}`;
  audio.setTimbre({ voice: settings.voice, timbre: settings.timbre, glide: settings.glide });
  $("regionOut").value = regionLabel(settings);
  $("regionFollow").disabled = !settings.region;
  $("playbackNote").textContent = PLAYBACK_NOTES[settings.playback];
  $("playbackSummary").textContent = `${PLAYBACK_LABELS[settings.playback]} · ${settings.heads} ${settings.heads === 1 ? "head" : "heads"}`;
  $("showGrid").checked = display.grid;
  $("showLabels").checked = display.labels;
}

function headMarkerText(marker, offset) {
  marker.style.left = `${offset * 100}%`;
  marker.setAttribute("aria-valuenow", offset.toFixed(4));
  marker.setAttribute("aria-valuetext", `${Math.round(offset * 100)}% of the cycle`);
  marker.title = `Playhead ${Number(marker.dataset.headIndex) + 1} · ${Math.round(offset * 100)}%`;
}

function markerOffsetFromPointer(event) {
  const bounds = $("headLayoutTrack").getBoundingClientRect();
  return clamp01((event.clientX - bounds.left) / Math.max(1, bounds.width));
}

// Markers are rebuilt only when the layout changes, so a drag never loses its captured element.
function syncHeadTrack() {
  const { settings } = state;
  const offsets = headOffsets(settings);
  const signature = JSON.stringify([settings.playback, offsets, settings.headAxes.slice(0, settings.heads), settings.headDirections.slice(0, settings.heads)]);
  const track = $("headLayoutTrack");
  if (track.dataset.signature === signature) return;
  track.dataset.signature = signature;
  const focused = document.activeElement?.closest?.("#headLayoutTrack") ? document.activeElement.id : null;
  const line = settings.playback === "line";
  const markers = offsets.map((offset, index) => {
    const marker = document.createElement("button");
    marker.className = "head-marker";
    marker.type = "button";
    marker.id = `headMarker${index}`;
    marker.dataset.headIndex = String(index);
    marker.style.setProperty("--head-color", HEAD_COLORS[index % HEAD_COLORS.length]);
    marker.setAttribute("role", "slider");
    marker.setAttribute("aria-label", `Playhead ${index + 1} relative phase`);
    marker.setAttribute("aria-valuemin", "0");
    marker.setAttribute("aria-valuemax", "1");
    marker.innerHTML = `<span>${index + 1}</span>`;
    headMarkerText(marker, offset);
    return marker;
  });
  const options = offsets.map((offset, index) => {
    const button = document.createElement("button");
    button.type = "button";
    button.id = `headOption${index}`;
    button.className = "head-option-toggle";
    button.dataset.headIndex = String(index);
    button.style.left = `${offset * 100}%`;
    button.style.setProperty("--head-color", HEAD_COLORS[index % HEAD_COLORS.length]);
    const alternate = line ? settings.headAxes[index] === "horizontal" : settings.headDirections[index] < 0;
    button.textContent = line ? (alternate ? "—" : "│") : (alternate ? "←" : "→");
    button.setAttribute("aria-pressed", String(alternate));
    button.setAttribute("aria-label", line ? `Line ${index + 1} ${alternate ? "horizontal" : "vertical"}; rotate 90 degrees` : `Playhead ${index + 1} ${alternate ? "reverse" : "forward"}; change direction`);
    button.title = button.getAttribute("aria-label");
    return button;
  });
  track.replaceChildren(...markers, ...options);
  if (focused) $(focused)?.focus();
}

function focusRowInput(id) {
  const input = $("expressionList").querySelector(`[data-row-id="${id}"] .expression-input`);
  input?.focus();
  return Boolean(input);
}

const list = $("expressionList");
listen(list, "input", (event) => {
  const item = event.target.closest(".expression-row");
  if (!item) return;
  const id = item.dataset.rowId;
  if (event.target.classList.contains("expression-input")) setState(updateRow(state, id, { text: event.target.value }));
  else if (event.target.classList.contains("slider-value")) setState(setParameterValue(state, id, Number(event.target.value), analysis));
  else if (event.target.classList.contains("drum-count")) { const row = state.rows[rowIndex(id)]; if (row?.drum) setState(updateRow(state, id, { drum: { ...row.drum, count: Number(event.target.value) } }), { rebuild: false }); }
});
listen(list, "change", (event) => {
  const item = event.target.closest(".expression-row");
  if (!item) return;
  const id = item.dataset.rowId;
  const row = state.rows[rowIndex(id)];
  if (!row) return;
  if (event.target.classList.contains("drum-placement")) setState(updateRow(state, id, { drum: { ...row.drum, placement: event.target.value } }), { rebuild: false });
  else if (event.target.classList.contains("layer-voice")) setState(updateRow(state, id, { voice: event.target.value || null }), { rebuild: false });
  else if (event.target.classList.contains("drum-voice")) setState(updateRow(state, id, { drum: { ...row.drum, voice: event.target.value } }), { rebuild: false });
  else if (event.target.classList.contains("drum-pitch")) setState(updateRow(state, id, { drum: { ...row.drum, pitch: Number(event.target.value) } }), { rebuild: false });
  else if (event.target.classList.contains("slider-mode")) setState(updateRow(state, id, { slider: { ...row.slider, mode: event.target.value } }), { rebuild: false });
  else if (event.target.classList.contains("slider-speed")) setState(updateRow(state, id, { slider: { ...row.slider, speed: Number(event.target.value) } }), { rebuild: false });
  else if (event.target.classList.contains("slider-min") || event.target.classList.contains("slider-max")) {
    const slider = sanitizeSlider({ ...row.slider, min: event.target.classList.contains("slider-min") ? Number(event.target.value) : row.slider.min, max: event.target.classList.contains("slider-max") ? Number(event.target.value) : row.slider.max });
    setState(updateRow(state, id, { slider }));
  } else if (event.target.classList.contains("range-low") || event.target.classList.contains("range-high")) {
    const current = row.range ?? [...DEFAULT_RANGE];
    const range = sanitizeRange([event.target.classList.contains("range-low") ? Number(event.target.value) : current[0], event.target.classList.contains("range-high") ? Number(event.target.value) : current[1]]);
    setState(updateRow(state, id, { range }));
  }
});
listen(list, "click", (event) => {
  const item = event.target.closest(".expression-row");
  if (!item) return;
  const id = item.dataset.rowId;
  const row = state.rows[rowIndex(id)];
  if (!row) return;
  const button = event.target.closest("button");
  if (!button) return;
  if (button.classList.contains("expression-swatch")) setState(updateRow(state, id, { visible: !row.visible }));
  else if (button.dataset.role) { const drumsNext = button.dataset.role === "drums"; if ((row.role === "drums") !== drumsNext) { setState(updateRow(state, id, { role: drumsNext ? "drums" : "contour", drum: drumsNext ? (row.drum ?? {}) : null }), { rebuild: false }); status(drumsNext ? "This layer now fires strikes; set their count, placement and voice above the switch." : "This layer sounds as a wave again."); } }
  else if (button.classList.contains("row-color")) setState(updateRow(state, id, { color: COLORS[(COLORS.indexOf(row.color) + 1) % COLORS.length] }));
  else if (button.classList.contains("row-delete")) { const index = rowIndex(id); setState(removeRow(state, id)); const neighbor = state.rows[Math.min(index, state.rows.length - 1)]; if (!(neighbor && focusRowInput(neighbor.id))) $("newExpression").focus(); }
  else if (button.classList.contains("slider-play")) { setState(updateRow(state, id, { slider: { ...row.slider, animating: !row.slider.animating } })); }
  else if (button.dataset.addSliders) { setState(addSliders(state, button.dataset.addSliders.split(","))); focusRowInput(id); }
});
listen(list, "focusin", (event) => {
  const item = event.target.closest(".expression-row");
  if (!item || selectedId === item.dataset.rowId) return;
  selectedId = item.dataset.rowId;
  renderRows();
  requestFrame();
});
listen(list, "keydown", (event) => {
  if (!event.target.classList.contains("expression-input")) return;
  const item = event.target.closest(".expression-row");
  const id = item.dataset.rowId;
  const index = rowIndex(id);
  if (event.key === "Enter") {
    event.preventDefault();
    const next = addRow(state, "");
    const created = next.rows.at(-1);
    const rows = [...next.rows.slice(0, index + 1), created, ...next.rows.slice(index + 1, -1)];
    setState({ ...next, rows });
    focusRowInput(created.id);
  } else if (event.key === "Backspace" && event.target.value === "" && state.rows.length > 0) {
    event.preventDefault();
    setState(removeRow(state, id));
    const previous = state.rows[Math.max(0, index - 1)];
    if (!(previous && focusRowInput(previous.id))) $("newExpression").focus();
  } else if (event.key === "ArrowDown" || event.key === "ArrowUp") {
    const target = state.rows[index + (event.key === "ArrowDown" ? 1 : -1)];
    if (target) { event.preventDefault(); focusRowInput(target.id); } else if (event.key === "ArrowDown") { event.preventDefault(); $("newExpression").focus(); }
  }
});

listen($("newExpressionForm"), "submit", (event) => {
  event.preventDefault();
  const input = $("newExpression");
  const text = input.value.trim();
  if (!text) return;
  setState(addRow(state, text));
  input.value = "";
  const created = state.rows.at(-1);
  status(describeAdded(created));
});
listen($("newExpression"), "keydown", (event) => {
  if (event.key === "ArrowUp" && state.rows.length) { event.preventDefault(); focusRowInput(state.rows.at(-1).id); }
});

function describeAdded(row) {
  const info = rowInfo(row?.id);
  if (!info) return "Added.";
  if (info.error) return info.missing?.length ? `Added · ${info.missing.join(", ")} undefined; add a slider to hear it move.` : `Added · ${info.error}`;
  return `Added ${KIND_LABELS[info.kind] ?? info.kind}.`;
}

listen($("playButton"), "click", () => setPlaying(!playing));
listen($("resetAll"), "click", () => {
  setPlaying(false);
  setTravel(0);
  hitTimes.clear(); previousHeads = null;
  sliderDirections.clear();
  setState(applySnapshot(PRESETS.find((preset) => preset.id === DEFAULT_PRESET_ID).snapshot));
  status("Reset to the opening scene. Audio stays as it was.");
});
listen($("sweepTempo"), "input", (event) => setSettings({ sweepSeconds: sweepSecondsFromTempo(Number(event.target.value)) }, { retime: true }));
listen($("traceOctaves"), "input", (event) => setSettings({ traceOctaves: Number(event.target.value) }));
listen($("playbackMode"), "click", (event) => { const button = event.target.closest("button[data-playback]"); if (button) setSettings({ playback: button.dataset.playback }); });
listen($("playheadMotion"), "click", (event) => { const button = event.target.closest("button[data-motion]"); if (button) setSettings({ motion: button.dataset.motion }, { retime: true }); });
listen($("directionToggle"), "click", () => setSettings({ direction: -state.settings.direction }, { retime: true }));
listen($("addHead"), "click", () => setHeads(state.settings.heads + 1));
listen($("removeHead"), "click", () => setHeads(state.settings.heads - 1));
listen($("heads"), "input", (event) => setHeads(Number(event.target.value)));
listen($("resetHeadSpacing"), "click", () => setSettings({ headOffsets: undefined }, { retime: true }));
listen($("crossHeadAxes"), "click", () => setSettings({ headAxes: [...crossedAxes(state.settings.heads), ...state.settings.headAxes.slice(state.settings.heads)] }));
listen($("position"), "pointerdown", () => { positionDragging = true; });
listen($("position"), "input", (event) => scrubPosition(clamp01(event.target.value)));
listen($("position"), "change", (event) => { positionDragging = false; scrubPosition(clamp01(event.target.value)); });
listen(window, "pointerup", () => { positionDragging = false; });
let markerPointer = null;
listen($("headLayoutTrack"), "pointerdown", (event) => {
  const marker = event.target.closest(".head-marker");
  if (!marker) return;
  event.preventDefault();
  markerPointer = { id: event.pointerId, index: Number(marker.dataset.headIndex) };
  marker.setPointerCapture?.(event.pointerId);
  setHeadOffset(markerPointer.index, markerOffsetFromPointer(event));
});
listen($("headLayoutTrack"), "pointermove", (event) => { if (markerPointer?.id === event.pointerId) setHeadOffset(markerPointer.index, markerOffsetFromPointer(event)); });
const endMarker = (event) => { if (markerPointer?.id === event.pointerId) markerPointer = null; };
listen($("headLayoutTrack"), "pointerup", endMarker);
listen($("headLayoutTrack"), "pointercancel", endMarker);
listen($("headLayoutTrack"), "click", (event) => { const option = event.target.closest(".head-option-toggle"); if (option) { toggleHeadOption(Number(option.dataset.headIndex)); $(option.id)?.focus(); } });
listen($("headLayoutTrack"), "keydown", (event) => {
  const marker = event.target.closest(".head-marker");
  if (!marker) return;
  const step = event.key === "ArrowRight" || event.key === "ArrowUp" ? 1 : event.key === "ArrowLeft" || event.key === "ArrowDown" ? -1 : 0;
  if (!step && event.key !== "Home" && event.key !== "End") return;
  event.preventDefault();
  const index = Number(marker.dataset.headIndex);
  const current = headOffsets(state.settings)[index];
  const next = event.key === "Home" ? 0 : event.key === "End" ? 0.9999 : current + step * (event.shiftKey ? 0.05 : 0.01);
  setHeadOffset(index, ((next % 1) + 1) % 1);
  announce(`Playhead ${index + 1} spacing ${Math.round(headOffsets(state.settings)[index] * 100)} percent.`);
});
listen($("regionUseView"), "click", () => setRegion({ ...state.view }));
listen($("regionFit"), "click", () => { const fitted = fitRegion(geometry, state.view); setRegion(fitted ?? { ...state.view }); status(fitted ? "Play region fitted to the visible curves." : "Nothing is drawn to fit; the play region now matches the view."); });
listen($("regionFollow"), "click", () => setRegion(null));
listen($("voice"), "change", (event) => setSettings({ voice: event.target.value }));
listen($("timbre"), "input", (event) => setSettings({ timbre: Number(event.target.value) }));
listen($("glide"), "input", (event) => setSettings({ glide: Number(event.target.value) }));
listen($("pitchSource"), "change", (event) => setSettings({ pitchSource: event.target.value }));
listen($("angleMode"), "click", (event) => {
  const button = event.target.closest("button[data-angle]");
  if (button) setState({ ...state, settings: { ...state.settings, angle: button.dataset.angle } });
});
listen($("showGrid"), "change", (event) => { display.grid = event.target.checked; saveSoon(); requestFrame(); });
listen($("showLabels"), "change", (event) => { display.labels = event.target.checked; saveSoon(); requestFrame(); });
for (const id of ["viewXMin", "viewXMax", "viewYMin", "viewYMax"]) {
  listen($(id), "change", () => setView({ xMin: Number($("viewXMin").value), xMax: Number($("viewXMax").value), yMin: Number($("viewYMin").value), yMax: Number($("viewYMax").value) }));
}
listen($("squareView"), "click", () => { const { width, height } = viewSize(); setView(squareView(state.view, width, height)); });
listen($("homeView"), "click", () => { const { width, height } = viewSize(); setView(homeView(width, height)); });
listen($("zoomIn"), "click", () => zoomCenter(1.3));
listen($("zoomOut"), "click", () => zoomCenter(1 / 1.3));

function zoomCenter(factor) {
  const { width, height } = viewSize();
  setView(zoomView(state.view, factor, width / 2, height / 2, width, height));
}

function pointerPosition(event) {
  const bounds = canvas.getBoundingClientRect();
  return [event.clientX - bounds.left, event.clientY - bounds.top];
}

listen(canvas, "pointerdown", (event) => {
  canvas.focus({ preventScroll: true });
  canvas.setPointerCapture(event.pointerId);
  const [px, py] = pointerPosition(event);
  pointers.set(event.pointerId, { x: px, y: py });
  if (pointers.size === 2) {
    const [a, b] = [...pointers.values()];
    drag = { kind: "pinch", distance: Math.hypot(a.x - b.x, a.y - b.y) || 1, midX: (a.x + b.x) / 2, midY: (a.y + b.y) / 2 };
    return;
  }
  const camera = renderer.camera(state.view);
  const near = nearestPoint(geometry, camera, px, py, 16);
  const handle = near?.draggable?.some(Boolean) ? null : regionHandleAt(px, py);
  if (near?.draggable?.some(Boolean)) {
    drag = { kind: "point", id: near.id, draggable: near.draggable };
    canvas.classList.add("is-pointing");
  } else if (handle) {
    const [wx, wy] = camera.toWorld(px, py);
    drag = { kind: "region", handle, x: wx, y: wy, start: { ...state.settings.region } };
    canvas.classList.add("is-pointing");
  } else {
    drag = { kind: "pan", x: px, y: py };
    canvas.classList.add("is-panning");
  }
  hover = null;
  $("hoverReadout").value = "";
});

listen(canvas, "pointermove", (event) => {
  const [px, py] = pointerPosition(event);
  if (pointers.has(event.pointerId)) pointers.set(event.pointerId, { x: px, y: py });
  const { width, height } = viewSize();
  if (drag?.kind === "pinch" && pointers.size === 2) {
    const [a, b] = [...pointers.values()];
    const distance = Math.hypot(a.x - b.x, a.y - b.y) || 1;
    const midX = (a.x + b.x) / 2, midY = (a.y + b.y) / 2;
    let view = panView(state.view, midX - drag.midX, midY - drag.midY, width, height);
    view = zoomView(view, distance / drag.distance, midX, midY, width, height);
    drag = { kind: "pinch", distance, midX, midY };
    setView(view);
    return;
  }
  if (drag?.kind === "pan") {
    setView(panView(state.view, px - drag.x, py - drag.y, width, height));
    drag = { kind: "pan", x: px, y: py };
    return;
  }
  if (drag?.kind === "region") {
    const [x, y] = renderer.camera(state.view).toWorld(px, py);
    const { start, handle } = drag;
    const minSpan = { x: (state.view.xMax - state.view.xMin) * 0.01, y: (state.view.yMax - state.view.yMin) * 0.01 };
    if (handle.kind === "move") {
      const dx = x - drag.x, dy = y - drag.y;
      setRegion({ xMin: start.xMin + dx, xMax: start.xMax + dx, yMin: start.yMin + dy, yMax: start.yMax + dy });
    } else {
      const next = { ...start };
      if (handle.edges.x === "min") next.xMin = Math.min(x, start.xMax - minSpan.x);
      if (handle.edges.x === "max") next.xMax = Math.max(x, start.xMin + minSpan.x);
      if (handle.edges.y === "min") next.yMin = Math.min(y, start.yMax - minSpan.y);
      if (handle.edges.y === "max") next.yMax = Math.max(y, start.yMin + minSpan.y);
      setRegion(next);
    }
    return;
  }
  if (drag?.kind === "point") {
    const [x, y] = renderer.camera(state.view).toWorld(px, py);
    let next = state;
    const [nameX, nameY] = drag.draggable;
    if (nameX) next = setParameterValue(next, parameterRowId(nameX), x, analysis);
    if (nameY) next = setParameterValue(next, parameterRowId(nameY), y, analyzeState(next));
    setState(next);
    return;
  }
  const camera = renderer.camera(state.view);
  const near = nearestPoint(geometry, camera, px, py, 14);
  const changed = (near?.id !== hover?.id) || (near && (near.x !== hover?.x || near.y !== hover?.y)) || (!near && hover);
  hover = near ? { id: near.id, color: near.color, x: near.x, y: near.y, label: near.label } : null;
  canvas.classList.toggle("is-pointing", Boolean(near?.draggable?.some(Boolean)) || Boolean(regionHandleAt(px, py)));
  if (changed) {
    $("hoverReadout").value = near ? `${near.label} · (${formatCoordinate(near.x)}, ${formatCoordinate(near.y)})` : "";
    requestFrame();
  }
});

function parameterRowId(name) {
  const index = analysis.rows.findIndex((info) => info.kind === "parameter" && info.definition?.name === name);
  return index < 0 ? null : state.rows[index].id;
}

function endPointer(event) {
  pointers.delete(event.pointerId);
  if (canvas.hasPointerCapture?.(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
  if (pointers.size === 0) { drag = null; canvas.classList.remove("is-panning", "is-pointing"); }
  else if (pointers.size === 1) { const [remaining] = [...pointers.values()]; drag = { kind: "pan", x: remaining.x, y: remaining.y }; }
}
listen(canvas, "pointerup", endPointer);
listen(canvas, "pointercancel", endPointer);
listen(canvas, "pointerleave", () => { if (!drag && hover) { hover = null; $("hoverReadout").value = ""; requestFrame(); } });
listen(canvas, "wheel", (event) => {
  event.preventDefault();
  const [px, py] = pointerPosition(event);
  const scale = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? 240 : 1;
  const factor = Math.exp(-Math.max(-120, Math.min(120, event.deltaY * scale)) * 0.0022);
  const { width, height } = viewSize();
  setView(zoomView(state.view, factor, px, py, width, height));
}, { passive: false });
listen(canvas, "keydown", (event) => {
  const { width, height } = viewSize();
  const xStep = (state.view.xMax - state.view.xMin) * 0.08, yStep = (state.view.yMax - state.view.yMin) * 0.08;
  const moves = { ArrowLeft: [xStep, 0], ArrowRight: [-xStep, 0], ArrowUp: [0, yStep], ArrowDown: [0, -yStep] };
  if (moves[event.key]) {
    event.preventDefault();
    const [dx, dy] = moves[event.key];
    setView({ xMin: state.view.xMin - dx, xMax: state.view.xMax - dx, yMin: state.view.yMin + dy, yMax: state.view.yMax + dy });
  } else if (event.key === "+" || event.key === "=") { event.preventDefault(); zoomCenter(1.25); }
  else if (event.key === "-" || event.key === "_") { event.preventDefault(); zoomCenter(1 / 1.25); }
  else if (event.key === "Home") { event.preventDefault(); setView(homeView(width, height)); }
  else if (event.key === " ") { event.preventDefault(); setPlaying(!playing); }
});

listen(window, "pagehide", (event) => { if (!event.persisted) void dispose(); });

renderRows();
syncSettings();
status("Ready · edit an expression, or enable Audio and press Play to hear the curves.");
frame(performance.now());

export function diagnosticSnapshot() {
  return {
    ready, disposed, playing, armed, starting,
    audioTime: audio.currentTime,
    travel: currentTravel(sweepAnchor.source === "audio" && audio.currentTime !== null ? audio.currentTime : performance.now() / 1000),
    drums: { triggers: triggers.map((trigger) => ({ id: trigger.id, rowId: trigger.rowId, x: trigger.x, y: trigger.y, s: trigger.s, branch: trigger.branch })), hits: drumHits },
    reading: reading ? { mode: state.settings.playback, heads: reading.heads.map((head) => ({ index: head.index, phase: head.phase, kind: head.guide.kind, axis: head.guide.axis ?? null })), contacts: reading.contacts.length, region: reading.region, center: reading.center, branches: new Set(reading.contacts.map((contact) => `${contact.id}:${contact.branch ?? "p"}`)).size, sample: reading.contacts.slice(0, 24).map((contact) => ({ id: contact.id, head: contact.head, branch: contact.branch ?? null, x: contact.x, y: contact.y })) } : null,
    timbre: { ...audio.timbreSettings },
    view: { ...state.view },
    settings: { ...state.settings },
    display: { ...display },
    level,
    selectedId,
    rows: state.rows.map((row, index) => ({ id: row.id, text: row.text, color: row.color, visible: row.visible, slider: row.slider, range: row.range, role: row.role, drum: row.drum, voice: row.voice ?? null, kind: analysis.rows[index].kind, error: analysis.rows[index].error, missing: analysis.rows[index].missing, value: analysis.rows[index].value })),
    geometry: geometry.map((item) => ({ id: item.id, kind: item.kind, segments: item.segments.length, points: item.points.length, samples: item.segments.reduce((sum, segment) => sum + segment.length / 2, 0) })),
    presetCount: PRESETS.length,
  };
}

export async function dispose() {
  if (disposed) return;
  disposed = true;
  cancelAnimationFrame(frameId);
  frameId = 0;
  clearTimeout(saveTimer);
  abort.abort();
  observer?.disconnect();
  presets?.destroy();
  await Promise.all([audio.destroy(), drums.close()]);
  armed = false;
  playing = false;
}

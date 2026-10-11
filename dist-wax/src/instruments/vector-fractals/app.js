import { MODES, PRESETS, CONTOUR_LANDMARKS, TRACE_VOICES, sanitizeState, randomizeState, clamp, wrap, juliaParameter } from './model.js';
import { createTraceBank } from './trace-model.js';
import { VectorRenderer } from './renderer.js';
import { ContourRenderer } from './contour-renderer.js';
import { ContourNavigation } from './contour-navigation.js';
import { VectorAudio } from './audio.js';
import { createRangeField } from '../../ui/primitives/range-field.js';
import { enhanceRangeKnob } from '../../ui/primitives/range-knob.js';
import { createAudioStrip } from '../../ui/patterns/audio-strip.js';
import { registerHeaderPresets } from '../../site/header-presets.js';

const $ = id => document.getElementById(id);
const initialMode = MODES.some(m => m.id === location.hash.slice(1)) ? location.hash.slice(1) : 'julia';
let state = { ...PRESETS.find(p => p.snapshot.mode === initialMode).snapshot };
let bank = null, playing = false, armed = false, starting = false, stopping = false, disposed = false;
let level = .35, scanPhase = 0, voyage = 0, telemetry = null, lastTime = performance.now(), lastPaint = 0;
let request = 0, busy = false, queued = null, buildTimer = 0, frameId = 0, activePointer = null;
let contourRequest = 0, contourBusy = false, contourTimer = 0, contourResult = null, contourPhase = 'idle';
let selectedPath = -1, candidates = [], navigation = null, lastContourSend = 0;
let contourLayers = null, traceLayers = null, traceBank = null, tracePhase = 0;
const isTrace = () => state.mode === 'explorer' && state.contourReader === 'trace';
const playbackLabel = () => isTrace() ? 'Playing · synced detail layers' : 'Playing · shared XY oscillator';
const noContour = () => isTrace() ? !traceBank?.layers.some(layer => layer.x.length) : selectedPath < 0;
const modeMemory = new Map(), fields = new Map(), knobs = [];
const abort = new AbortController();
const listen = (node, name, callback, options = {}) => node.addEventListener(name, callback, { ...options, signal: abort.signal });
const status = message => { $('status').textContent = message; };
const renderer = new VectorRenderer($('stage'), $('waveforms'), $('parameterMap'));
const contourRenderer = new ContourRenderer($('contourStage'));
const audio = new VectorAudio({ onTelemetry(data) { telemetry = data; }, onError(error) {
  armed = false; telemetry = null; strip.setAudioState('error'); status(error.message);
} });
const strip = createAudioStrip({ buttonId: 'audioButton', levelId: 'level', level, max: .8, onAudioClick: toggleAudio,
  onLevelInput(value) { level = value; audio.send({ type: 'level', value }); },
});
$('audioHost').append(strip);

const worker = new Worker(new URL('./worker.js', import.meta.url), { type: 'module' });
worker.onmessage = ({ data }) => {
  if (disposed) return;
  busy = false;
  if (data.id === request) {
    $('stage').dataset.building = 'false';
    if (data.error) status(`Contour could not update: ${data.error} The previous sound is retained.`);
    else {
      bank = data.bank; audio.send({ type: 'bank', bank });
      $('stage').dataset.ready = 'true';
      status(state.mode === 'explorer' && noContour() ? 'No contour here · pan or choose a region' : armed ? (playing ? playbackLabel() : 'Audio on · press Play') : 'Ready · enable Audio, then Play');
    }
  }
  if (queued) sendQueued();
};
worker.onerror = event => { busy = false; status(`Contour worker stopped: ${event.message || 'reload to retry'}`); };
function sendQueued() {
  if (busy || !queued || disposed) return;
  busy = true; worker.postMessage(queued); queued = null;
}
function build() {
  if (state.mode === 'explorer') {
    ++request; queued = null; clearTimeout(buildTimer);
    requestContours(true); return;
  }
  clearTimeout(contourTimer); contourTimer = 0; contourBusy = false; ++contourRequest;
  contourWorker.postMessage({ type: 'cancel' });
  queued = { id: ++request, state }; $('stage').dataset.building = 'true';
  clearTimeout(buildTimer); buildTimer = setTimeout(sendQueued, 35);
}

const contourWorker = new Worker(new URL('./contour-worker.js', import.meta.url), { type: 'module' });
function explorerView() {
  const rect = $('contourStage').parentElement.getBoundingClientRect();
  return { x: state.viewX, y: state.viewY, width: state.viewWidth, aspect: Math.max(.25, rect.width / Math.max(1, rect.height)) };
}
function wholeExplorerView() {
  const aspect = explorerView().aspect;
  return { x: -.5, y: 0, width: Math.min(5, Math.max(3.4, 2.35 * aspect)), aspect };
}
function fitOpeningView(input) {
  if (input.mode !== 'explorer' || input.viewX !== -.5 || input.viewY !== 0 || input.viewWidth !== 3.4) return input;
  return { ...input, viewWidth: wholeExplorerView().width };
}
function refreshExplorerUI() {
  const zoom = wholeExplorerView().width / state.viewWidth;
  $('contourZoom').textContent = `${zoom < 10 ? zoom.toFixed(1) : Math.round(zoom).toLocaleString()}×`;
  const landmark = CONTOUR_LANDMARKS.find(p => {
    const width = p.id === 'whole' ? wholeExplorerView().width : p.width;
    return Math.abs(p.x - state.viewX) < width * 1e-7 && Math.abs(p.y - state.viewY) < width * 1e-7 && Math.abs(width - state.viewWidth) < width * 1e-7;
  });
  $('contourRegion').value = landmark?.id ?? 'custom';
  $('zoomIn').disabled = state.viewWidth <= 1.00001e-10;
  $('zoomOut').disabled = state.viewWidth >= 4.99999;
}
function requestContours(immediate = false) {
  if (disposed || state.mode !== 'explorer') return;
  // Invalidate the old viewport immediately, even while the next send is throttled.
  ++contourRequest;
  contourBusy = true;
  $('nextStrand').disabled = true;
  $('contourStage').dataset.building = 'true'; $('exportContour').disabled = true;
  $('contourProgress').textContent = state.viewWidth <= 1.00001e-10 ? 'Zoom limit · refining…' : 'Refining…';
  if (immediate) { clearTimeout(contourTimer); contourTimer = 0; }
  if (contourTimer) return;
  const send = () => {
    contourTimer = 0;
    if (disposed || state.mode !== 'explorer') return;
    const view = explorerView(), rect = $('contourStage').getBoundingClientRect();
    const resolution = Math.round(clamp(rect.width * (state.contourQuality === 'fine' ? 1.3 : .8), 220, state.contourQuality === 'fine' ? 850 : 560));
    // The responsive whole framing is wider on a wide canvas. Keep its initial
    // levels at 4 / 8 / 12 so Broad still outlines the set instead of becoming
    // a huge, mostly cropped exterior circle on desktop.
    const depth = clamp(12 + 12 * Math.log2(wholeExplorerView().width / view.width) + state.contourBias, 4, 320);
    lastContourSend = performance.now();
    contourWorker.postMessage({ id: contourRequest, view, depth, resolution, layered: true });
  };
  if (immediate) send();
  else contourTimer = setTimeout(send, Math.max(0, 100 - (performance.now() - lastContourSend)));
}
function updateExplorerView(view, { settled = false } = {}) {
  if (disposed || state.mode !== 'explorer') return;
  state = sanitizeState({ ...state, viewX: view.x, viewY: view.y, viewWidth: view.width });
  refreshExplorerUI();
  if (settled) presets.refresh();
  requestContours(settled);
}
function queueSelectedSound() {
  if (contourPhase !== 'complete') return;
  updateTraceBank();
  let path = null;
  if (contourResult && selectedPath >= 0) {
    const start = contourResult.offsets[selectedPath] * 2, end = contourResult.offsets[selectedPath + 1] * 2;
    path = { points: contourResult.points.slice(start, end), closed: Boolean(contourResult.closed[selectedPath]) };
  }
  queued = { id: ++request, state, kind: 'contour', path };
  sendQueued();
}
function updateTraceBank() {
  if (!contourLayers || contourPhase !== 'complete') return;
  traceLayers = contourLayers;
  traceBank = createTraceBank(traceLayers, { finePath: selectedPath, featureSize: state.featureSize,
    anchor: state.strandX == null ? null : { x: state.strandX, y: state.strandY } });
  audio.send({ type: 'trace-bank', bank: traceBank });
  refreshTraceLayers();
}
function refreshTraceLayers() {
  for (let i = 0; i < 3; i++) {
    const present = Boolean(traceBank?.layers[i]?.x.length);
    $(`layerStatus${i}`).textContent = present ? (state.layerEnabled[i] ? '' : 'muted') : traceBank ? 'outside view' : 'preparing';
    $(`traceLayer${i}`).classList.toggle('is-muted', !state.layerEnabled[i]);
  }
}
function drawContours() {
  contourRenderer.draw(contourResult, explorerView(), { selectedPath, scanPhase,
    traceBank: isTrace() ? traceBank : null, tracePhase,
    traceEnabled: state.layerEnabled, layers: isTrace() ? traceLayers : null });
}
function selectStrand(index, remember = true) {
  if (contourBusy || contourTimer || contourPhase !== 'complete' || !contourResult || index < 0 || index >= contourResult.closed.length) return;
  selectedPath = index;
  if (remember) {
    const vertex = Math.floor((contourResult.offsets[index] + contourResult.offsets[index + 1]) / 2) * 2;
    state = { ...state, strandX: contourResult.view.x + contourResult.points[vertex] * contourResult.view.width,
      strandY: contourResult.view.y + contourResult.points[vertex + 1] * contourResult.view.width };
    presets.refresh();
  }
  queueSelectedSound();
}
contourWorker.onmessage = ({ data }) => {
  if (disposed || state.mode !== 'explorer' || data.id !== contourRequest) return;
  if (data.error) {
    contourBusy = false; $('contourProgress').textContent = 'Could not refine';
    status(`Contour could not update: ${data.error}`); return;
  }
  if (!data.result) return;
  contourResult = data.result; contourPhase = data.phase; contourLayers = data.layers ?? [null, null, data.result];
  candidates = Array.from({ length: contourResult.closed.length }, (_, i) => i)
    .filter(i => contourResult.offsets[i + 1] - contourResult.offsets[i] >= 4)
    .sort((a, b) => (contourResult.offsets[b + 1] - contourResult.offsets[b]) - (contourResult.offsets[a + 1] - contourResult.offsets[a]));
  selectedPath = candidates[0] ?? -1;
  // Prime buffers for picking at this result's exact world-coordinate origin.
  drawContours();
  if (state.strandX != null && state.strandY != null) {
    const picked = contourRenderer.pick({ x: state.strandX, y: state.strandY }, explorerView(), 24);
    if (picked >= 0) selectedPath = picked;
  }
  $('contourStage').dataset.ready = 'true';
  $('nextStrand').disabled = data.phase !== 'complete' || candidates.length < 2;
  if (data.phase === 'complete') {
    contourBusy = false; $('contourStage').dataset.building = 'false';
    $('exportContour').disabled = Boolean(contourTimer);
    queueSelectedSound();
    $('contourProgress').textContent = noContour() ? 'No contour here' : (state.viewWidth <= 1.00001e-10 ? 'Zoom limit' : '');
  }
};
contourWorker.onerror = event => {
  contourBusy = false; $('contourProgress').textContent = 'Refinement stopped';
  status(`Contour worker stopped: ${event.message || 'reload to retry'}`);
};

for (const mode of MODES) {
  const button = document.createElement('button'); button.type = 'button'; button.textContent = mode.label; button.dataset.mode = mode.id;
  listen(button, 'click', () => switchMode(mode.id)); $('demoModes').append(button);
}

const parameters = [
  ['radius', 'Clearance', 1.025, 1.8, .001, v => `${v.toFixed(3)} r`, 'shapeKnobs'],
  ['detail', 'Detail', 8, 512, 1, v => `${v} harmonics`, 'shapeKnobs'],
  ['depth', 'Excursion', 0, .96, .01, v => `${Math.round(v * 100)}%`, 'shapeKnobs'],
  ['angle', 'Position', 0, 1, .001, v => `${Math.round(v * 360)}°`, 'shapeKnobs'],
  ['speed', 'Voyage rate', .005, .4, .001, v => `${v.toFixed(3)} Hz`, 'shapeKnobs'],
  ['contourBias', 'Edge detail', -8, 24, 1, v => `${Math.round((v + 8) / 32 * 100)}%`, 'shapeKnobs'],
  ['pitch', 'Pitch', 25, 1200, 1, v => `${v.toFixed(0)} Hz`, 'soundKnobs'],
  ['rotation', 'Rotation', -180, 180, 1, v => `${v.toFixed(0)}°`, 'soundKnobs'],
  ['traceRate', 'Cycle rate', .01, 1, .001, v => `${(1 / v).toFixed(1)} s / cycle`, 'traceKnobs'],
  ['featureSize', 'Feature size', .002, .08, .001, v => `${(v * 100).toFixed(1)}% of path`, 'traceKnobs'],
];
for (const [key, label, min, max, step, format, host] of parameters) {
  const field = createRangeField({ id: key, label, min, max, step, value: state[key], format,
    onInput: value => update({ [key]: value }),
  });
  $(host).append(field); knobs.push(enhanceRangeKnob(field.input, { scale: ['pitch', 'traceRate', 'featureSize'].includes(key) ? 'log' : 'linear' })); fields.set(key, field);
}
listen($('contourReader'), 'change', () => update({ contourReader: $('contourReader').value }));
for (let i = 0; i < 3; i++) {
  for (const voice of TRACE_VOICES) {
    const option = document.createElement('option'); option.value = voice;
    option.textContent = voice[0].toUpperCase() + voice.slice(1); $(`layerVoice${i}`).append(option);
  }
  listen($(`layerVoice${i}`), 'change', () => {
    const layerVoices = [...state.layerVoices]; layerVoices[i] = $(`layerVoice${i}`).value; update({ layerVoices });
  });
  listen($(`layerEnabled${i}`), 'change', () => {
    const layerEnabled = [...state.layerEnabled]; layerEnabled[i] = $(`layerEnabled${i}`).checked; update({ layerEnabled });
  });
}
for (const key of ['shape', 'component', 'traversal', 'readout']) listen($(key), 'change', () => update({ [key]: $(key).value }));
for (const key of ['vectors', 'reference']) listen($(key), 'change', () => update({ [key]: $(key).checked }));
listen($('contourQuality'), 'change', () => update({ contourQuality: $('contourQuality').value }));
listen($('contourRegion'), 'change', () => {
  const p = CONTOUR_LANDMARKS.find(p => p.id === $('contourRegion').value);
  if (p) { state = { ...state, strandX: null, strandY: null }; navigation.setView(p.id === 'whole' ? wholeExplorerView() : { ...explorerView(), x: p.x, y: p.y, width: p.width }, { notify: true }); }
});
listen($('zoomIn'), 'click', () => navigation.zoomBy(.65));
listen($('zoomOut'), 'click', () => navigation.zoomBy(1 / .65));
listen($('wholeView'), 'click', () => { state = { ...state, strandX: null, strandY: null }; navigation.reset(); });
listen($('nextStrand'), 'click', () => { if (candidates.length) selectStrand(candidates[(candidates.indexOf(selectedPath) + 1) % candidates.length]); });

const presets = registerHeaderPresets({ id: 'vector-fractals', presets: PRESETS, host: $('mainPresets'),
  capture: () => ({ ...state }), apply: snapshot => { state = fitOpeningView(sanitizeState(snapshot)); sync(); build(); audio.send({ type: 'state', state }); },
  randomize: (snapshot, random) => randomizeState(snapshot, random),
});

function sync() {
  const mode = MODES.find(m => m.id === state.mode);
  const explorer = state.mode === 'explorer';
  const trace = isTrace();
  document.body.style.setProperty('--vector-accent', mode.color);
  $('stage').dataset.mode = state.mode;
  $('stage').hidden = explorer; $('contourStage').hidden = !explorer;
  for (const id of ['contourActions', 'explorerControls', 'contourLegend', 'exportContour']) $(id).hidden = !explorer;
  for (const id of ['curveLegend', 'traversalField', 'vectorsField', 'referenceField']) $(id).hidden = explorer;
  $('traceControls').hidden = !trace; $('readerField').hidden = !explorer;
  $('xyReadoutField').hidden = trace; $('waveformMonitor').hidden = trace;
  $('traceLegend').hidden = !trace; $('contourLegend').hidden = !explorer || trace;
  $('scanHint').textContent = trace ? 'one shared cycle · three voices' : 'trace slowed 256×';
  $('contourReader').value = state.contourReader;
  for (let i = 0; i < 3; i++) { $(`layerVoice${i}`).value = state.layerVoices[i]; $(`layerEnabled${i}`).checked = state.layerEnabled[i]; }
  refreshTraceLayers();
  $('gestureHint').textContent = explorer ? 'drag to pan · scroll / pinch to zoom' : '↔ rotation · ↕ clearance';
  $('contourQuality').value = state.contourQuality;
  for (const button of $('demoModes').children) button.setAttribute('aria-pressed', String(button.dataset.mode === state.mode));
  for (const [key, field] of fields) field.setValue(state[key]);
  for (const key of ['shape', 'component', 'traversal', 'readout']) $(key).value = state[key];
  for (const key of ['vectors', 'reference']) $(key).checked = state[key];
  $('shapeField').hidden = state.mode !== 'julia'; $('componentField').hidden = state.mode !== 'voyager';
  const exploratory = state.mode === 'voyager' || (state.mode === 'julia' && state.shape === 'cardioid');
  fields.get('depth').hidden = !exploratory; fields.get('angle').hidden = !exploratory;
  fields.get('speed').hidden = state.mode !== 'voyager';
  fields.get('radius').hidden = explorer; fields.get('detail').hidden = explorer;
  fields.get('contourBias').hidden = !explorer;
  fields.get('rotation').hidden = trace;
  $('mapLabel').textContent = explorer ? 'Region in Mandelbrot' : state.mode === 'mandelbrot' ? 'Cardioid + period-two bulb' : 'Julia parameter c';
  $('demoDescription').textContent = {
    julia: 'Counter-rotating vectors make a Julia contour. The same curve is the waveform.',
    mandelbrot: 'A contour around the whole Mandelbrot set. Move closer to reveal its structure.',
    voyager: 'A moving Mandelbrot parameter continuously reshapes the Julia oscillator.',
    explorer: trace ? 'Three detail levels, three synced voices. Height sings, position pans, and bends color the sound.' : 'Zoom into the outline. New detail emerges as you move; select a strand to shape the sound.',
  }[state.mode];
  history.replaceState(null, '', `#${state.mode}`);
  presets?.refresh();
  navigation?.setActive(explorer);
  if (explorer) { navigation?.setView(explorerView(), { notify: false }); refreshExplorerUI(); }
}
function update(patch) {
  state = sanitizeState({ ...state, ...patch }); sync(); audio.send({ type: 'state', state });
  if (Object.hasOwn(patch, 'featureSize')) updateTraceBank();
  if (Object.keys(patch).some(k => !['pitch', 'rotation', 'speed', 'readout', 'vectors', 'reference', 'contourReader', 'traceRate', 'featureSize', 'layerVoices', 'layerEnabled'].includes(k))) build();
}
function switchMode(mode) {
  if (!MODES.some(m => m.id === mode) || mode === state.mode) return;
  modeMemory.set(state.mode, { ...state });
  state = { ...(modeMemory.get(mode) ?? fitOpeningView(PRESETS.find(p => p.snapshot.mode === mode).snapshot)) };
  sync(); audio.send({ type: 'state', state }); build();
}
function setPlaying(value) {
  playing = value; audio.send({ type: 'playing', value });
  $('playButton').setAttribute('aria-pressed', String(value)); $('playButton').setAttribute('aria-label', value ? 'Pause' : 'Play');
  $('playIcon').setAttribute('d', value ? 'M6 5H10V19H6ZM14 5H18V19H14Z' : 'M8 5 19 12 8 19Z');
  $('transportState').textContent = value ? (armed ? 'Playing' : 'Preview · audio off') : 'Paused';
  status(armed ? (value ? playbackLabel() : 'Audio on · paused') : 'Audio off · visual preview only');
}
async function toggleAudio() {
  if (disposed || starting || stopping) return;
  if (armed) {
    armed = false; stopping = true; telemetry = null; strip.setAudioState('off');
    status('Audio off'); setPlaying(playing);
    try { await audio.stop(); } finally { stopping = false; }
    return;
  }
  starting = true; strip.setAudioState('starting');
  try {
    await audio.start({ state, bank, traceBank, level, playing, scanPhase, tracePhase, voyage });
    if (disposed) return;
    // Edits and Play while loading must win over the initial snapshot.
    audio.send({ type: 'state', state }); audio.send({ type: 'bank', bank });
    audio.send({ type: 'trace-bank', bank: traceBank });
    audio.send({ type: 'playing', value: playing }); audio.send({ type: 'level', value: level });
    armed = true; strip.setAudioState('on'); setPlaying(playing);
  } catch (error) { armed = false; strip.setAudioState('error'); status(`Audio could not start: ${error.message}`); }
  finally { starting = false; }
}

listen($('playButton'), 'click', () => setPlaying(!playing));
listen($('reset'), 'click', () => {
  state = { ...fitOpeningView(PRESETS.find(p => p.snapshot.mode === state.mode).snapshot) };
  scanPhase = 0; tracePhase = 0; voyage = 0; telemetry = null;
  audio.send({ type: 'reset' }); audio.send({ type: 'state', state }); sync(); build();
});
listen(window, 'hashchange', () => switchMode(location.hash.slice(1)));
listen($('info'), 'click', () => $('helpDialog').showModal());
listen($('closeHelp'), 'click', () => $('helpDialog').close());
listen($('stage'), 'keydown', event => {
  const edits = { ArrowLeft: { rotation: state.rotation - 5 }, ArrowRight: { rotation: state.rotation + 5 },
    ArrowUp: { radius: state.radius - .015 }, ArrowDown: { radius: state.radius + .015 } };
  if (edits[event.key]) { event.preventDefault(); update(edits[event.key]); }
  else if (event.code === 'Space') { event.preventDefault(); setPlaying(!playing); }
});
listen($('stage'), 'pointerdown', event => {
  if (event.button !== 0 || activePointer) return;
  activePointer = { id: event.pointerId, x: event.clientX, y: event.clientY, rotation: state.rotation, radius: state.radius };
  $('stage').setPointerCapture(event.pointerId); $('stage').focus({ preventScroll: true });
});
listen($('stage'), 'pointermove', event => {
  if (activePointer?.id !== event.pointerId) return;
  update({ rotation: clamp(activePointer.rotation + (event.clientX - activePointer.x) * .7, -180, 180),
    radius: activePointer.radius + (event.clientY - activePointer.y) * .002 });
});
for (const name of ['pointerup', 'pointercancel', 'lostpointercapture']) listen($('stage'), name, event => {
  if (activePointer?.id !== event.pointerId) return;
  activePointer = null;
  if ($('stage').hasPointerCapture(event.pointerId)) $('stage').releasePointerCapture(event.pointerId);
});

function frame(time) {
  if (disposed) return;
  const dt = Math.min(.1, (time - lastTime) / 1000); lastTime = time;
  if (armed && telemetry && audio.context) {
    const elapsed = playing && audio.context.state === 'running' ? Math.max(0, audio.context.currentTime - telemetry.time) : 0;
    scanPhase = wrap(telemetry.scanPhase + elapsed * telemetry.frequency / 256);
    tracePhase = wrap((telemetry.tracePhase ?? tracePhase) + elapsed * (telemetry.traceRate ?? state.traceRate));
    voyage = wrap(telemetry.voyage + (state.mode === 'voyager' ? elapsed * state.speed : 0));
  } else if (playing && !armed) {
    scanPhase = wrap(scanPhase + dt * state.pitch / 256);
    if (isTrace()) tracePhase = wrap(tracePhase + dt * state.traceRate);
    if (state.mode === 'voyager') voyage = wrap(voyage + dt * state.speed);
  }
  if (time - lastPaint > 1000 / 30 && !document.hidden) {
    lastPaint = time;
    renderer.draw(bank, state.mode === 'explorer' ? { ...state, vectors: false, reference: false } : state, { scanPhase, voyage, frequency: armed && telemetry ? telemetry.frequency : state.pitch,
      rotation: armed && telemetry ? telemetry.rotation : state.rotation * Math.PI / 180, sampleRate: audio.context?.sampleRate ?? 48000 });
  }
  if (state.mode === 'explorer' && !document.hidden) drawContours();
  frameId = requestAnimationFrame(frame);
}

export function diagnosticSnapshot() {
  return { state: { ...state }, playing, armed, starting, ready: Boolean(bank) && (state.mode !== 'explorer' || Boolean(contourResult)), building: busy || Boolean(queued) || (state.mode === 'explorer' && (contourBusy || Boolean(contourTimer))),
    frames: bank?.frames.length ?? 0, voyage, scanPhase, tracePhase, c: bank ? juliaParameter(bank.state, voyage) : null,
    trace: { ready: Boolean(traceBank), phase: tracePhase, rate: telemetry?.traceRate ?? state.traceRate,
      layers: traceBank?.layers.map((layer, i) => ({ pathIndex: layer.pathIndex, depth: layer.depth, samples: layer.x.length, enabled: state.layerEnabled[i], voice: state.layerVoices[i] })) ?? [] },
    audioTime: audio.context?.currentTime ?? null, renderer: renderer.gl ? 'webgl' : 'canvas', disposed,
    contours: { request: contourRequest, phase: contourPhase, view: contourResult?.view ?? null, depth: contourResult?.depth ?? null,
      vertices: (contourResult?.points.length ?? 0) / 2, paths: contourResult?.closed.length ?? 0, selectedPath, stats: contourResult?.stats ?? null,
      renderer: contourRenderer.diagnosticSnapshot(), navigation: navigation?.diagnosticSnapshot() } };
}
export async function dispose() {
  if (disposed) return; disposed = true; cancelAnimationFrame(frameId); clearTimeout(buildTimer); abort.abort();
  clearTimeout(contourTimer); contourWorker.terminate(); navigation?.destroy(); contourRenderer.destroy(); resizeObserver.disconnect();
  worker.terminate(); presets.destroy(); strip.destroy(); for (const knob of knobs) knob.destroy();
  for (const field of fields.values()) field.destroy(); renderer.destroy(); await audio.destroy();
}
// Leave a back/forward-cache document intact; real navigation tears down resources.
listen(window, 'pagehide', event => { if (!event.persisted) void dispose(); });
navigation = new ContourNavigation($('contourStage'), {
  view: explorerView(), homeView: wholeExplorerView(),
  isActive: () => state.mode === 'explorer', onViewChange: updateExplorerView,
  onSelect(point) { if (contourBusy || contourTimer || contourPhase !== 'complete') return; const index = contourRenderer.pick(point, explorerView()); if (index >= 0) selectStrand(index); },
});
const resizeObserver = new ResizeObserver(() => {
  if (state.mode !== 'explorer' || disposed) return;
  const view = explorerView(); navigation.homeView = wholeExplorerView(); navigation.setView(view, { notify: false }); requestContours();
});
resizeObserver.observe($('contourStage'));
listen(document, 'visibilitychange', () => {
  if (document.hidden) { clearTimeout(contourTimer); contourTimer = 0; ++contourRequest; contourWorker.postMessage({ type: 'cancel' }); contourBusy = false; }
  else if (state.mode === 'explorer') requestContours(true);
});
listen($('exportContour'), 'click', () => {
  if (!contourResult || contourPhase !== 'complete' || contourBusy || contourTimer) return;
  const height = 1200 / contourResult.view.aspect;
  const results = isTrace() ? contourLayers : [contourResult];
  const groups = results.map((result, layer) => {
    if (!result) return '';
    const paths = [];
    for (let p = 0; p < result.closed.length; p++) {
      const points = [];
      for (let i = result.offsets[p]; i < result.offsets[p + 1]; i++) points.push(`${((result.points[i * 2] + .5) * 1200).toFixed(4)},${(height / 2 - result.points[i * 2 + 1] * 1200).toFixed(4)}`);
      paths.push(`<path d="M${points.join(' L')}${result.closed[p] ? ' Z' : ''}"/>`);
    }
    return `<g id="${isTrace() ? ['broad', 'curl', 'fine'][layer] : 'contour'}" fill="none" stroke="${isTrace() ? ['#ffba76', '#c69bff', '#80d9ff'][layer] : '#14738b'}" stroke-width=".8">${paths.join('')}</g>`;
  });
  const meta = JSON.stringify({ view: contourResult.view, logGreen: results.map(result => result ? -result.depth : null), approximation: 'Sampled exterior contours; unresolved narrow connections may alter topology.' }).replaceAll('&', '&amp;').replaceAll('<', '&lt;');
  const source = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 ${height}"><title>Morphazoid Mandelbrot contours</title><metadata>${meta}</metadata>${groups.join('')}</svg>`;
  const url = URL.createObjectURL(new Blob([source], { type: 'image/svg+xml' }));
  const a = document.createElement('a'); a.href = url; a.download = 'morphazoid-contours.svg'; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
});
state = fitOpeningView(state);
sync(); build(); frameId = requestAnimationFrame(frame);

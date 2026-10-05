import { BifurcatorEngine, MODELS, DEFAULT_PARAMS, PARAM_RANGES, ENUM_PARAMS, isShapeSonification, normalizeParams, createPreset } from './model.js';
import { rhythmRatio, shapeTempo } from './shape-reader.js';
import { CycleMonitor } from './cycle-monitor.js';
import { PRESETS, captureScene, randomizeScene } from './presets.js';
import { drawOrbit, drawCycles, drawShapePlayheads, drawTempoMap, drawSignal, modelColor, shapeHeadColor } from './renderer.js';
import { connectAudioOutput } from '../../audio-output-manager.js';
import { resumeAudioContext, withAudioTimeout } from '../../audio-startup.js';
import { registerHeaderPresets } from '../../site/header-presets.js';
import { canvasSizing } from '../../graphics/canvas-sizing.js';

const $ = id => document.getElementById(id);
const canvas = $('stage'), signal = $('signal');
const ctx = canvas.getContext('2d'), signalCtx = signal.getContext('2d');
const listeners = new AbortController();
const listen = (target, type, callback, options = {}) => target.addEventListener(type, callback, { ...options, signal: listeners.signal });
const keys = Object.keys(PARAM_RANGES);
const axisLabels = { none: 'constant', height: 'height', horizontal: 'horizontal position', center: 'center distance', depth: 'depth', angle: 'angle', bend: 'bend', path: 'path position' };
const headRows = Array.from({ length: 16 }, (_, index) => {
  const row = document.createElement('tr'); row.hidden = true;
  const name = document.createElement('th'); name.scope = 'row'; name.textContent = String(index + 1); name.style.color = shapeHeadColor(index);
  const cells = Array.from({ length: 3 }, () => document.createElement('td'));
  row.append(name, ...cells); $('headRows').append(row);
  return { row, cells };
});
const previewRate = 48000;
const preview = new BifurcatorEngine(previewRate);
const previewCycles = new CycleMonitor();
let params = normalizeParams(DEFAULT_PARAMS), latest = preview.snapshot();
let cycleState = previewCycles.snapshot(), graphic = 'orbit';
let audioContext = null, node = null, master = null, releaseOutput = null;
let enabled = false, starting = false, audioWanted = false, disposed = false;
let interrupted = false, audioFailed = false, revision = 0;
let frame = 0, lastDraw = 0, lastPreview = performance.now();
let history = [], wave = [], drag = null, presetController;
const previewWave = new Float32Array(256), previewTrace = new Float64Array(4);
let previewWaveCursor = 0, previewSamples = 0;
const previewWaveStride = Math.max(1, Math.round(previewRate * .04 / previewWave.length));
let cssWidth = 1, cssHeight = 1, pixelRatio = 1;
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');

const activeModel = () => MODELS.find(model => model.id === params.model);
const clamp = (v, min, max) => Math.min(max, Math.max(min, v));
function addTrail(items) {
  history.push(...items.filter(item => item.p.every(Number.isFinite) && Number.isFinite(item.n)));
  const limit = reducedMotion.matches ? 1800 : 4500;
  if (history.length > limit) history.splice(0, history.length - limit);
}
function refreshRegime() {
  const model = activeModel(), [min, max] = model.nativeRange;
  const native = min + params.regime * (max - min);
  $('regime').value = params.regime;
  $('regimeOut').textContent = native.toFixed(3);
  $('parameterValue').textContent = native.toFixed(2);
}
function refreshSweep() {
  const running = latest.sweep.running;
  $('sweepButton').setAttribute('aria-pressed', String(running));
  $('sweepButton').textContent = running ? 'Stop sweep' : 'Sweep splits';
  $('sweepProgress').textContent = running ? `${params.playing ? '' : 'Paused · '}${Math.round(latest.sweep.progress * 100)}%` : '';
}
function setGraphic(next) {
  graphic = next === 'tempo' && params.sonification === 'rhythm' ? 'tempo' : next === 'cycles' ? 'cycles' : 'orbit';
  document.body.dataset.graphic = graphic;
  $('orbitView').setAttribute('aria-pressed', String(graphic === 'orbit'));
  $('cycleView').setAttribute('aria-pressed', String(graphic === 'cycles'));
  $('tempoView').setAttribute('aria-pressed', String(graphic === 'tempo'));
  const shape = isShapeSonification(params.sonification), rhythm = params.sonification === 'rhythm';
  const scene = graphic === 'tempo' ? `tempo map with ${params.headCount} rhythm playheads and their actual BPM and beat phases` : graphic === 'cycles' ? 'overlaid synthesized wave cycles' : shape ? `growing contour with ${params.headCount} ${rhythm ? 'rhythm' : 'pitch'} playheads` : 'live nonlinear orbit';
  const vertical = verticalControl();
  canvas.setAttribute('aria-label', `${activeModel().label}: ${scene}. Left and right arrows change regime; up and down arrows change ${vertical.label}; Enter nudges the system.`);
  $('gestureHint').textContent = `Drag: regime ↔ · ${vertical.label} ↕`;
}
function verticalControl() {
  if (graphic === 'tempo' && params.sonification === 'rhythm') return params.tempoAxis === 'none' ? { key: 'tempo', range: 210, label: 'base tempo' } : { key: 'tempoSpan', range: 3, label: 'tempo range' };
  return isShapeSonification(params.sonification) ? { key: 'pitchSpan', range: 4, label: 'pitch span' } : { key: 'clarity', range: 1, label: 'clarity' };
}
function refreshShapeReadout() {
  if (!isShapeSonification(params.sonification)) return;
  const heads = (latest.shape?.heads ?? []).filter(head => head.index < params.headCount);
  $('headFrequencies').textContent = heads.length ? heads.map(head => `${head.index + 1}: ${head.frequency.toFixed(0)} Hz`).join(' · ') : 'Building contour';
  for (const { row } of headRows) row.hidden = true;
  for (const head of heads) {
    const { row, cells } = headRows[head.index]; row.hidden = false;
    cells[0].textContent = head.frequency.toFixed(0);
    cells[1].textContent = params.sonification === 'rhythm' ? `${head.tempo.toFixed(1)} · ×${head.ratio}` : '—';
    cells[2].textContent = `${(head.speed / 6).toFixed(2)}×`;
  }
}
function refreshTempoSummary() {
  const ratios = [...new Set(Array.from({ length: params.headCount }, (_, index) => rhythmRatio(index, params.rhythmRatios)))];
  const ranges = ratios.map((ratio, index) => {
    const head = Array.from({ length: params.headCount }, (_, i) => i).find(i => rhythmRatio(i, params.rhythmRatios) === ratio) ?? index;
    const low = shapeTempo(0, params, head), high = shapeTempo(1, params, head);
    return `×${ratio}: ${Math.abs(high - low) < .01 ? low.toFixed(0) : `${low.toFixed(0)}–${high.toFixed(0)}`} BPM`;
  });
  $('tempoSummary').textContent = `${axisLabels[params.tempoAxis]} → ${ranges.join(' · ')}`;
}
function acceptClock(state, cycles) {
  latest = state; cycleState = cycles;
  params.regime = state.params.regime;
  refreshRegime(); refreshSweep(); refreshShapeReadout();
}
function refreshControls() {
  const model = activeModel(), [min, max] = model.nativeRange;
  const shape = isShapeSonification(params.sonification), rhythm = params.sonification === 'rhythm';
  $('model').value = params.model;
  for (const key of Object.keys(ENUM_PARAMS)) $(key).value = params[key];
  $('growShape').checked = params.growShape;
  $('shapeReaderControls').hidden = !shape;
  $('rhythmControls').hidden = !rhythm;
  $('headReadouts').hidden = !shape;
  $('tempoView').hidden = !rhythm;
  $('shapeReaderHeading').textContent = rhythm ? 'Rhythm playheads' : 'Shape playheads';
  for (const [key, route] of [['tempoSpan', 'tempoAxis'], ['travelSpan', 'travelAxis'], ['amplitudeDepth', 'amplitudeAxis'], ['panWidth', 'panAxis']]) $(key).disabled = params[route] === 'none';
  $('waveControls').hidden = shape;
  $('clarityControl').hidden = shape;
  $('depthControl').hidden = shape;
  $('frequencyLabel').textContent = rhythm ? 'Base pitch' : shape ? 'Low pitch' : 'Pitch';
  $('speedLabel').textContent = shape ? 'Shape growth' : 'Motion rate';
  $('orbitView').textContent = shape ? 'Shape' : 'Orbit';
  const fixedDepth = !['lorenz', 'rossler'].includes(params.model) && ['pitchAxis', 'tempoAxis', 'travelAxis', 'amplitudeAxis', 'panAxis'].some(key => params[key] === 'depth');
  $('shapeHint').textContent = `${axisLabels[params.pitchAxis]} → continuous pitch.${fixedDepth ? ' Depth stays fixed in this model.' : ''}`;
  document.body.dataset.sonification = params.sonification;
  for (const key of keys) {
    $(key).value = params[key];
    let text = params[key].toFixed(2);
    if (key === 'regime') text = (min + params.regime * (max - min)).toFixed(3);
    if (key === 'frequency') text = `${params[key].toFixed(1)} Hz`;
    if (key === 'speed') text = `${text}×`;
    if (key === 'sweepSeconds') text = `${Math.round(params[key])} s`;
    if (key === 'headCount') text = `${params[key]} ${params[key] === 1 ? 'head' : 'heads'}`;
    if (key === 'headRate') text = `${text}×`;
    if (['pitchSpan', 'headSpread', 'travelSpan', 'tempoSpan'].includes(key)) text = `${text} oct`;
    if (key === 'tempo') text = `${params[key].toFixed(0)} BPM`;
    if (key === 'pulseDecay') text = `${Math.round(params[key] * 1000)} ms`;
    if (['clarity', 'depth', 'amplitudeDepth', 'panWidth'].includes(key)) text = `${Math.round(params[key] * 100)}%`;
    if (key === 'cutoff') text = params[key] >= 1000 ? `${(params[key] / 1000).toFixed(1)} kHz` : `${Math.round(params[key])} Hz`;
    $(`${key}Out`).textContent = text;
  }
  $('regimeLabel').textContent = `Regime · ${model.parameterSymbol}`;
  $('parameterLabel').textContent = model.parameterSymbol;
  $('parameterValue').textContent = (min + params.regime * (max - min)).toFixed(2);
  $('modelReadout').textContent = model.label;
  $('modelDescription').textContent = model.description;
  $('lorenzParameters').hidden = params.model !== 'lorenz';
  $('rosslerParameters').hidden = params.model !== 'rossler';
  $('playButton').setAttribute('aria-pressed', String(params.playing));
  $('playButton').setAttribute('aria-label', `${params.playing ? 'Pause' : 'Play'} Bifurcator`);
  setGraphic(graphic);
  document.body.style.setProperty('--accent', modelColor(params.model));
  $('liveStatus').textContent = `${enabled ? 'Audio on' : 'Audio off'} · ${params.playing ? shape ? params.growShape ? 'shape growing' : 'shape held · heads moving' : 'orbit moving' : 'paused'}`;
  presetController?.refresh();
  refreshSweep(); refreshShapeReadout(); refreshTempoSummary();
}
function applyParams(patch) {
  const previousModel = params.model;
  const previousPlaying = params.playing;
  const previousSonification = params.sonification;
  params = normalizeParams({ ...params, ...patch });
  if (params.model !== previousModel) { history = []; previewCycles.reset(); cycleState = previewCycles.snapshot(); latest = { ...latest, shape: null }; }
  if (params.sonification !== previousSonification) {
    previewCycles.reset(); cycleState = previewCycles.snapshot(); setGraphic('orbit');
    for (const id of ['lorenzParameters', 'rosslerParameters']) $(id).open = !isShapeSonification(params.sonification);
  }
  if (params.playing !== previousPlaying) previewCycles.discardPartial();
  const normalizedPatch = Object.fromEntries(Object.keys(patch).filter(key => Object.hasOwn(params, key)).map(key => [key, params[key]]));
  if (Object.hasOwn(normalizedPatch, 'regime') || Object.hasOwn(normalizedPatch, 'model') || Object.hasOwn(normalizedPatch, 'sonification')) latest = { ...latest, sweep: { ...latest.sweep, running: false } };
  preview.setParams(normalizedPatch);
  revision++;
  node?.port.postMessage({ type: 'params', params: normalizedPatch, revision });
  if (!node) latest = preview.snapshot();
  refreshControls();
}
function setLevel() {
  $('levelOut').textContent = `${Math.round(Number($('level').value) * 100)}%`;
  if (master && audioContext?.state !== 'closed') master.gain.setTargetAtTime(enabled ? Number($('level').value) : 0, audioContext.currentTime, .025);
}
function refreshAudio() {
  $('audioButton').disabled = starting;
  $('audioButton').setAttribute('aria-pressed', String(enabled));
  const state = starting ? 'starting' : interrupted ? 'interrupted' : audioFailed ? 'error' : enabled ? 'on' : 'off';
  $('audioState').textContent = state;
  $('audioButton').dataset.audioStateOwner = 'engine';
  $('audioButton').dataset.audioState = state;
  refreshControls();
}
function clearAudioGraph() {
  node?.port.postMessage({ type: 'dispose' });
  if (node) {
    node.port.onmessage = null; node.disconnect();
    previewCycles.reset(); cycleState = previewCycles.snapshot();
    lastPreview = performance.now();
  }
  master?.disconnect(); releaseOutput?.(); releaseOutput = null;
  if (audioContext) audioContext.onstatechange = null;
  if (audioContext && audioContext.state !== 'closed') void audioContext.close().catch(() => {});
  node = null; master = null; audioContext = null;
}
async function setAudio(next) {
  if (disposed) return;
  audioWanted = Boolean(next);
  if (!next) { enabled = false; interrupted = false; audioFailed = false; setLevel(); refreshAudio(); return; }
  if (starting) return;
  starting = true; $('audioError').hidden = true; refreshAudio();
  try {
    const AudioContextClass = window.AudioContext ?? window.webkitAudioContext;
    if (!AudioContextClass) throw new Error('This browser does not support Web Audio.');
    if (!audioContext) {
      audioContext = new AudioContextClass({ latencyHint: 'interactive' });
      audioContext.onstatechange = () => {
        if (disposed || starting || !audioWanted) return;
        if (audioContext?.state !== 'running') {
          enabled = false; interrupted = true; setLevel(); refreshAudio();
          $('liveStatus').textContent = 'Audio interrupted · tap Audio to resume';
        }
      };
    }
    // Resume from this explicit gesture before the asynchronous worklet fetch.
    await resumeAudioContext(audioContext);
    if (disposed) return;
    if (!node) {
      await withAudioTimeout(audioContext.audioWorklet.addModule(new URL('./processor.js', import.meta.url)));
      if (disposed) return;
      master = audioContext.createGain(); master.gain.value = 0;
      node = new AudioWorkletNode(audioContext, 'bifurcator', { numberOfInputs: 0, numberOfOutputs: 1, outputChannelCount: [2] });
      node.port.postMessage({ type: 'seek', state: preview.exportState(), revision });
      node.connect(master); releaseOutput = connectAudioOutput(audioContext, master);
      node.port.onmessage = ({ data }) => {
        if (disposed || data.type !== 'clock' || data.revision !== revision || data.snapshot.model !== params.model) return;
        // Keep the silent fallback at the latest acknowledged audio state.
        // Subsequent UI patches apply to this state, so a processor failure
        // cannot rewind a sweep or undo an edit waiting for acknowledgement.
        preview.importState(data.state);
        acceptClock(data.snapshot, data.cycles); wave = data.wave; addTrail(data.trail);
      };
      node.onprocessorerror = () => {
        enabled = false; audioWanted = false; audioFailed = true;
        $('audioError').hidden = false; $('audioError').textContent = 'The sound processor stopped. Tap Audio to restart.';
        clearAudioGraph(); refreshAudio();
      };
    }
    enabled = audioWanted; interrupted = false; audioFailed = false; setLevel();
  } catch (error) {
    enabled = false; audioWanted = false; interrupted = false; audioFailed = true; clearAudioGraph();
    if (!disposed) { $('audioError').hidden = false; $('audioError').textContent = `Audio could not start: ${error.message}`; }
  } finally { starting = false; if (!disposed) refreshAudio(); }
}
function nudge() {
  const amount = params.model === 'fold' && latest.point[0] > 0 ? -.65 : .65;
  preview.perturb(amount); node?.port.postMessage({ type: 'nudge', amount });
}
function reset() {
  applyParams({ ...DEFAULT_PARAMS, playing: params.playing });
  preview.reset(); previewCycles.reset(); cycleState = previewCycles.snapshot();
  revision++; node?.port.postMessage({ type: 'reset', revision }); history = [];
  latest = node ? { ...latest, sweep: { running: false, progress: 0 } } : preview.snapshot(); refreshSweep();
}
function sweep() {
  if (latest.sweep.running) {
    preview.stopSweep(); revision++; node?.port.postMessage({ type: 'sweep', start: false, revision });
    latest = { ...latest, sweep: { ...latest.sweep, running: false } }; refreshSweep(); return;
  }
  applyParams(createPreset('logistic', { regime: (2.8 - 2.6) / 1.4, frequency: params.frequency, sweepSeconds: params.sweepSeconds, clarity: .6, depth: 1, speed: 1, playing: params.playing }));
  preview.startSweep(); revision++; node?.port.postMessage({ type: 'sweep', start: true, revision });
  latest = node ? { ...latest, sweep: { running: true, progress: 0 } } : preview.snapshot(); setGraphic('cycles'); refreshSweep();
}
function resize() {
  const box = canvas.getBoundingClientRect();
  const sizing = canvasSizing(box, devicePixelRatio, { pixelBudget: 1_250_000, maxPixelRatio: 1.5 });
  cssWidth = Math.max(1, box.width); cssHeight = Math.max(1, box.height);
  pixelRatio = sizing.pixelRatio ?? sizing.dpr ?? Math.min(devicePixelRatio || 1, 1.5);
  const width = Math.round(cssWidth * pixelRatio), height = Math.round(cssHeight * pixelRatio);
  if (canvas.width !== width) canvas.width = width;
  if (canvas.height !== height) canvas.height = height;
  const rect = signal.getBoundingClientRect(), sw = Math.round(rect.width * pixelRatio), sh = Math.round(rect.height * pixelRatio);
  if (signal.width !== sw) signal.width = sw;
  if (signal.height !== sh) signal.height = sh;
}
const observer = new ResizeObserver(resize); observer.observe($('stageWrap'));
function render(now) {
  if (disposed) return;
  const interval = reducedMotion.matches ? 1000 / 15 : 1000 / 30;
  if (now - lastDraw >= interval) {
    lastDraw = now; ctx.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
    if (graphic === 'tempo') drawTempoMap(ctx, cssWidth, cssHeight, latest.shape, params);
    else if (graphic === 'cycles') drawCycles(ctx, cssWidth, cssHeight, cycleState.cycles, params, cycleState.period ?? cycleState.status);
    else if (isShapeSonification(params.sonification)) drawShapePlayheads(ctx, cssWidth, cssHeight, latest.shape, params);
    else drawOrbit(ctx, cssWidth, cssHeight, history, params);
    signalCtx.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
    drawSignal(signalCtx, signal.width / pixelRatio, signal.height / pixelRatio, wave, modelColor(params.model), enabled && params.playing);
  }
  frame = requestAnimationFrame(render);
}
// Silent preview never creates Web Audio. Once armed, graphics consume only
// actual worklet snapshots; UI/render stalls cannot interrupt its sound.
const previewTimer = setInterval(() => {
  const now = performance.now(), elapsed = clamp((now - lastPreview) / 1000, 0, .06); lastPreview = now;
  if (node || disposed || document.hidden) return;
  const count = Math.round(elapsed * previewRate);
  const stride = Math.max(1, Math.min(32, Math.floor(previewRate / (params.frequency * params.speed * 16))));
  const firstTrace = Math.max(0, count - stride * 768);
  let first = true; const points = [];
  for (let i = 0; i < count; i++) {
    preview.sample();
    if (params.playing) previewCycles.push(preview.left, preview.phase);
    previewSamples++;
    if (params.playing && i >= firstTrace && previewSamples % stride === 0) {
      preview.writeTrace(previewTrace);
      points.push({ p: Array.from(previewTrace.subarray(0, 3)), n: previewTrace[3], break: first && firstTrace > 0 });
      first = false;
    }
    if (previewSamples % previewWaveStride === 0) {
      previewWave[previewWaveCursor] = preview.left; previewWaveCursor = (previewWaveCursor + 1) % previewWave.length;
    }
  }
  addTrail(points);
  acceptClock(preview.snapshot(), previewCycles.snapshot());
  wave = Array.from({ length: previewWave.length }, (_, i) => previewWave[(previewWaveCursor + i) % previewWave.length]);
}, 40);

for (const key of keys) listen($(key), 'input', () => applyParams({ [key]: Number($(key).value) }));
for (const key of Object.keys(ENUM_PARAMS)) listen($(key), 'change', () => applyParams({ [key]: $(key).value }));
listen($('growShape'), 'change', () => applyParams({ growShape: $('growShape').checked }));
listen($('model'), 'change', () => {
  const model = MODELS.find(item => item.id === $('model').value);
  if (model) applyParams({ model: model.id, regime: model.defaultRegime });
});
listen($('level'), 'input', setLevel);
listen($('audioButton'), 'click', () => { void setAudio(!enabled); });
listen($('playButton'), 'click', () => applyParams({ playing: !params.playing }));
listen($('nudgeButton'), 'click', nudge); listen($('resetButton'), 'click', reset);
listen($('orbitView'), 'click', () => setGraphic('orbit'));
listen($('cycleView'), 'click', () => setGraphic('cycles'));
listen($('tempoView'), 'click', () => setGraphic('tempo'));
listen($('sweepButton'), 'click', sweep);
listen(canvas, 'pointerdown', event => {
  if (event.button !== 0) return;
  drag = { id: event.pointerId, x: event.clientX, y: event.clientY, regime: params.regime, clarity: params.clarity, pitchSpan: params.pitchSpan, tempo: params.tempo, tempoSpan: params.tempoSpan };
  canvas.setPointerCapture(event.pointerId); canvas.focus({ preventScroll: true });
});
listen(canvas, 'pointermove', event => {
  if (!drag || drag.id !== event.pointerId) return;
  const box = canvas.getBoundingClientRect();
  const { key, range } = verticalControl(), [low, high] = PARAM_RANGES[key];
  const vertical = { [key]: clamp(drag[key] - (event.clientY - drag.y) / box.height * range, low, high) };
  applyParams({ regime: clamp(drag.regime + (event.clientX - drag.x) / box.width, 0, 1), ...vertical });
});
for (const event of ['pointerup', 'pointercancel', 'lostpointercapture']) listen(canvas, event, () => { drag = null; });
listen(canvas, 'keydown', event => {
  const scale = event.shiftKey ? .002 : .015;
  if (event.key === 'ArrowLeft') applyParams({ regime: params.regime - scale });
  else if (event.key === 'ArrowRight') applyParams({ regime: params.regime + scale });
  else if (event.key === 'ArrowUp' || event.key === 'ArrowDown') { const { key, range } = verticalControl(); applyParams({ [key]: params[key] + (event.key === 'ArrowUp' ? 1 : -1) * scale * range }); }
  else if (event.key === 'Enter' && !event.repeat) nudge();
  else return;
  event.preventDefault();
});
presetController = registerHeaderPresets({
  id: 'bifurcator', presets: PRESETS, capture: () => captureScene(params),
  apply: scene => applyParams({ ...scene, playing: params.playing }), randomize: randomizeScene,
});

function dispose() {
  if (disposed) return;
  disposed = true; audioWanted = false; enabled = false;
  listeners.abort(); clearInterval(previewTimer); cancelAnimationFrame(frame);
  observer.disconnect(); presetController.destroy(); clearAudioGraph();
}
listen(window, 'pagehide', event => { if (!event.persisted) dispose(); else drag = null; });
listen(window, 'pageshow', () => { lastPreview = performance.now(); lastDraw = 0; });
window.bifurcator = Object.freeze({
  snapshot: () => ({ params: { ...params }, enabled, starting, disposed, point: [...latest.point], nativeParameter: latest.nativeParameter, trailLength: history.length, output: Number($('level').value), contextState: audioContext?.state ?? 'uncreated', model: latest.model, time: latest.diagnostics.time, paused: latest.diagnostics.paused, graphic, sweep: { ...latest.sweep }, shape: latest.shape, channels: latest.channels, cycles: { count: cycleState.count, period: cycleState.period, status: cycleState.status, generation: cycleState.generation } }),
  dispose,
});
preview.setParams(params); refreshControls(); resize(); frame = requestAnimationFrame(render);

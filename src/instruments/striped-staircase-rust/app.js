import { STRIPED_STAIRCASE_DEFAULTS, STRIPED_STAIRCASE_VIEWS, advancePingPong,
  cameraFromView, createStaircaseFrame, createStripedStaircaseRenderer, formatComplexCoordinate,
  normalizeStaircaseSettings, panCamera, viewById, zoomCameraAt } from '../striped-staircase/striped-staircase.js';
import { StaircaseEngine } from './engine.js';

const $ = id => document.getElementById(id);
const descriptions = [
  ['Contour', 'The measured outline becomes a repeating stereo wave. Detail brings out its sharper bends.'],
  ['Harmonics', 'The band’s vertical distribution weights sixteen harmonics. Hold depth to hear the same shape as a sustained spectrum.'],
  ['Stripe strikes', 'Crossing a light/dark depth stripe strikes the current shape. Hold stops new strikes; existing tails finish.'],
  ['Resonant body', 'Contour length and bends tune and excite a bank of resonances. Body lengthens their response.'],
];
const defaults = { progress: .12, direction: 1, speed: .035, baseFrequency: 73, brightness: .55, body: .5,
  level: .48, mode: 0, palette: 0, hold: false, view: 'seahorse' };
const state = { ...defaults, audio: false, playing: false, camera: cameraFromView(viewById('seahorse')),
  settings: normalizeStaircaseSettings(STRIPED_STAIRCASE_DEFAULTS), clock: 0, revision: 0, acceptedRevision: 0,
  audioRevision: 0, ready: false, disposed: false };
const signalOwner = new AbortController();
const on = (target, name, fn, options = {}) => target.addEventListener(name, fn, { ...options, signal: signalOwner.signal });
const canvas = $('stage'), overlay = $('contourOverlay'), overlayContext = overlay.getContext('2d');
let renderer, worker, field, context, engine, starting = false, audioEpoch = 0, renderFrame = 0, previousTime = 0;
let rebuildTimer = 0, pendingJob = null, workerBusy = false, observer, aspect = 1;
const status = text => { $('liveStatus').textContent = text; };
const keys = ['progress', 'speed', 'baseFrequency', 'brightness', 'body', 'level'];
const structureKeys = ['startIteration', 'maxIterations', 'steps', 'stripePeriod'];

function updateControls() {
  for (const key of keys) {
    $(key).value = state[key];
    $(key + 'Out').textContent = key === 'progress' ? state[key].toFixed(3)
      : key === 'speed' ? `${(1 / state.speed).toFixed(1)} s / journey`
      : key === 'baseFrequency' ? `${Math.round(state[key])} Hz` : `${Math.round(state[key] * 100)}%`;
  }
  for (const key of structureKeys) { $(key).value = state.settings[key]; $(key + 'Out').textContent = Number(state.settings[key].toFixed(1)); }
  $('holdButton').setAttribute('aria-pressed', String(state.hold));
  $('playButton').setAttribute('aria-pressed', String(state.playing));
  $('playButton').setAttribute('aria-label', state.playing ? 'Pause depth motion' : 'Play depth motion');
  $('audioButton').setAttribute('aria-pressed', String(state.audio));
  $('audioButton').setAttribute('aria-busy', String(starting));
  $('audioState').textContent = starting ? 'starting' : state.audio ? 'on' : 'off';
  $('viewPreset').value = state.view; $('palette').value = state.palette;
  for (const button of document.querySelectorAll('[data-mode]')) button.setAttribute('aria-pressed', String(Number(button.dataset.mode) === state.mode));
  $('modeHeading').textContent = descriptions[state.mode][0]; $('modeDescription').textContent = descriptions[state.mode][1];
  $('body').disabled = state.mode < 2;
  document.querySelector('label[for="body"] b').textContent = state.mode === 2 ? 'Ring' : 'Body';
}
function sendControls() { engine?.controls(state); }
function transport() { engine?.transport(state); updateControls(); }
function seek(value, direction = state.direction) {
  state.progress = Math.max(0, Math.min(1, value)); state.direction = direction;
  engine?.seek(state.progress, direction); updateControls();
}
function drainWorker() {
  if (workerBusy || !pendingJob || state.disposed) return;
  workerBusy = true; worker.postMessage(pendingJob); pendingJob = null;
}
function queueField(delay = 65) {
  if (state.disposed) return;
  clearTimeout(rebuildTimer); state.revision++;
  status('Preparing this view…');
  rebuildTimer = setTimeout(() => {
    renderer?.renderField(state.camera, state.settings.maxIterations);
    pendingJob = { type: 'analyze', revision: state.revision, camera: { ...state.camera }, settings: { ...state.settings }, aspect, resolution: 112 };
    drainWorker();
  }, delay);
}
function initWorker() {
  worker = new Worker(new URL('./worker.js', import.meta.url), { type: 'module' });
  worker.onmessage = ({ data }) => {
    workerBusy = false;
    if (state.disposed) return;
    if (data.revision === state.revision) {
      if (data.type === 'error' || data.error) status(`Field preparation failed: ${data.error || data.message}`);
      else if (data.type === 'field') {
        field = data; state.ready = true; state.acceptedRevision = data.revision;
        engine?.field(data.table, data.frames, data.revision);
        status('Ready · hold a depth and compare the studies.');
      }
    }
    drainWorker();
  };
  worker.onerror = event => {
    worker.terminate(); workerBusy = false; pendingJob = null;
    status(`Field preparation failed: ${event.message}. Move or reset the view to retry.`);
    if (!state.disposed) initWorker();
  };
}
async function closeAudio() {
  const old = context; engine?.dispose(); engine = null; context = null;
  if (old && old.state !== 'closed') await old.close().catch(() => {});
}
function audioFailure(error) {
  state.audio = false; starting = false; audioEpoch++; status(error.message); updateControls(); void closeAudio();
}
async function toggleAudio() {
  if (state.disposed || starting) return;
  if (state.audio) { state.audio = false; transport(); return; }
  if (engine) {
    try { await context.resume(); state.audio = true; transport(); }
    catch (error) { audioFailure(error); }
    return;
  }
  const epoch = ++audioEpoch; starting = true; updateControls();
  try {
    // Creation/resume belongs to the direct, explicit Audio gesture.
    context = new AudioContext(); const currentContext = context;
    const resumed = currentContext.resume(); resumed.catch(() => {});
    const created = await StaircaseEngine.create(currentContext, {
      onState(data) {
        if (state.disposed || epoch !== audioEpoch) return;
        state.progress = data.depth; state.direction = data.direction; state.clock = data.clock; state.audioRevision = data.revision;
      }, onError: error => { if (epoch === audioEpoch && !state.disposed) audioFailure(error); },
    });
    await resumed;
    if (state.disposed || epoch !== audioEpoch) { created.dispose(); return; }
    engine = created; engine.controls(state); engine.seek(state.progress, state.direction);
    if (field) engine.field(field.table, field.frames, field.revision);
    starting = false; state.audio = true; transport();
  } catch (error) { if (epoch === audioEpoch) audioFailure(error); }
}
function resize() {
  if (state.disposed) return;
  const rect = canvas.getBoundingClientRect(), ratio = Math.min(1.5, devicePixelRatio || 1, Math.sqrt(1_200_000 / Math.max(1, rect.width * rect.height)));
  const nextAspect = rect.width / Math.max(1, rect.height);
  renderer?.resize(Math.round(rect.width * ratio), Math.round(rect.height * ratio));
  overlay.width = canvas.width; overlay.height = canvas.height;
  if (Math.abs(aspect - nextAspect) > .01) { aspect = nextAspect; queueField(); }
}
function render(now) {
  if (state.disposed) return;
  const delta = previousTime ? Math.min(.1, (now - previousTime) / 1000) : 0; previousTime = now;
  if (!engine && state.playing && !state.hold) Object.assign(state, advancePingPong(state.progress, state.direction, delta * state.speed));
  const frame = createStaircaseFrame(state.progress, state.settings, 'slide');
  renderer?.render({ ...frame, stepPhase: .5 }, state.settings, state.camera, state.direction, state.palette);
  overlayContext.clearRect(0, 0, overlay.width, overlay.height);
  if (field?.revision === state.revision) {
    const path = field.overlays[Math.round(state.progress * (field.frames - 1))]?.points;
    if (path?.length) {
      overlayContext.strokeStyle = '#ddffe6'; overlayContext.lineWidth = 1.6; overlayContext.globalAlpha = .85;
      overlayContext.beginPath();
      for (let i = 0; i < path.length; i += 2) {
        const x = path[i] * overlay.width, y = path[i + 1] * overlay.height;
        if (i === 0) overlayContext.moveTo(x, y); else overlayContext.lineTo(x, y);
      }
      overlayContext.stroke();
    }
  }
  if (document.activeElement !== $('progress')) $('progress').value = state.progress;
  $('progressOut').textContent = state.progress.toFixed(3);
  $('depthReadout').textContent = `Depth ${frame.renderLow.toFixed(1)}–${frame.renderHigh.toFixed(1)}`;
  $('coordinateReadout').textContent = formatComplexCoordinate(state.camera.centerX, state.camera.centerY);
  renderFrame = requestAnimationFrame(render);
}
function zoom(factor, point = { x: .5, y: .5 }) { state.camera = zoomCameraAt(state.camera, point, factor, aspect); queueField(); }
function resetView() { state.camera = cameraFromView(viewById(state.view)); queueField(); }
function reset() {
  const level = state.level, audio = state.audio;
  Object.assign(state, defaults, { level, audio, playing: false, settings: normalizeStaircaseSettings(STRIPED_STAIRCASE_DEFAULTS) });
  seek(defaults.progress, 1); resetView(); sendControls(); transport();
}
for (const view of STRIPED_STAIRCASE_VIEWS) {
  if (view.id === 'seahorse') continue;
  const option = document.createElement('option'); option.value = view.id; option.textContent = view.label; $('viewPreset').append(option);
}
on($('audioButton'), 'click', () => void toggleAudio());
on($('playButton'), 'click', () => { state.playing = !state.playing; transport(); });
on($('holdButton'), 'click', () => { state.hold = !state.hold; transport(); });
on($('resetAll'), 'click', reset);
for (const key of keys) on($(key), 'input', () => {
  const value = Number($(key).value); if (!Number.isFinite(value)) return;
  if (key === 'progress') seek(value); else { state[key] = value; updateControls(); sendControls(); }
});
for (const key of structureKeys) on($(key), 'input', () => {
  state.settings = normalizeStaircaseSettings({ ...state.settings, [key]: Number($(key).value) }); updateControls(); queueField();
});
for (const button of document.querySelectorAll('[data-mode]')) on(button, 'click', () => {
  state.mode = Number(button.dataset.mode); sendControls(); updateControls();
});
on($('viewPreset'), 'change', () => { state.view = $('viewPreset').value; resetView(); });
on($('palette'), 'change', () => { state.palette = Number($('palette').value); });
on($('zoomIn'), 'click', () => zoom(.7)); on($('zoomOut'), 'click', () => zoom(1 / .7)); on($('homeView'), 'click', resetView);
const pointAt = event => { const rect = canvas.getBoundingClientRect(); return { x: (event.clientX - rect.left) / rect.width, y: (event.clientY - rect.top) / rect.height }; };
on(canvas, 'wheel', event => { event.preventDefault(); zoom(Math.exp(Math.max(-.5, Math.min(.5, event.deltaY * .002))), pointAt(event)); }, { passive: false });
on(canvas, 'dblclick', event => zoom(.5, pointAt(event)));
const pointers = new Map(); let gesture = null;
const gestureState = () => {
  const points = [...pointers.values()];
  if (points.length > 1) return { x: (points[0].x + points[1].x) / 2, y: (points[0].y + points[1].y) / 2,
    distance: Math.hypot(points[0].x - points[1].x, points[0].y - points[1].y) };
  return points.length ? { ...points[0], distance: 0 } : null;
};
on(canvas, 'pointerdown', event => {
  if (event.button !== 0) return; canvas.setPointerCapture(event.pointerId); canvas.focus({ preventScroll: true });
  pointers.set(event.pointerId, { x: event.clientX, y: event.clientY }); gesture = gestureState();
});
on(canvas, 'pointermove', event => {
  if (!pointers.has(event.pointerId)) return;
  pointers.set(event.pointerId, { x: event.clientX, y: event.clientY }); const next = gestureState();
  if (gesture) {
    state.camera = panCamera(state.camera, next.x - gesture.x, next.y - gesture.y, canvas.clientHeight);
    if (gesture.distance > 0 && next.distance > 0) {
      const rect = canvas.getBoundingClientRect(); state.camera = zoomCameraAt(state.camera,
        { x: (next.x - rect.left) / rect.width, y: (next.y - rect.top) / rect.height }, gesture.distance / next.distance, aspect);
    }
    queueField();
  }
  gesture = next;
});
for (const name of ['pointerup', 'pointercancel', 'lostpointercapture']) on(canvas, name, event => {
  pointers.delete(event.pointerId); gesture = gestureState();
  if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
});
on(canvas, 'keydown', event => {
  if (event.ctrlKey || event.metaKey || event.altKey) return;
  if (event.key === '+' || event.key === '=') zoom(.8);
  else if (event.key === '-') zoom(1.25);
  else if (event.key === 'Home') resetView();
  else if (event.key.startsWith('Arrow')) {
    const d = 28; state.camera = panCamera(state.camera,
      event.key === 'ArrowRight' ? -d : event.key === 'ArrowLeft' ? d : 0,
      event.key === 'ArrowDown' ? -d : event.key === 'ArrowUp' ? d : 0, canvas.clientHeight); queueField();
  } else return;
  event.preventDefault(); event.stopPropagation();
});
on(canvas, 'webglcontextlost', event => { event.preventDefault(); renderer = null; status('Graphics paused. Sound continues; restore the view when WebGL returns.'); });
on(canvas, 'webglcontextrestored', () => { try { renderer = createStripedStaircaseRenderer(canvas); resize(); queueField(); } catch (error) { status(error.message); } });
function teardown() {
  if (state.disposed) return;
  state.disposed = true; state.audio = false; state.playing = false; audioEpoch++;
  cancelAnimationFrame(renderFrame); clearTimeout(rebuildTimer); observer?.disconnect(); worker?.terminate(); renderer?.destroy();
  signalOwner.abort(); pointers.clear(); void closeAudio();
}
on(window, 'pagehide', teardown);
window.addEventListener('pageshow', event => { if (event.persisted && state.disposed) location.reload(); });
globalThis.__staircaseStudies = { snapshot: () => ({ ...state, camera: { ...state.camera }, settings: { ...state.settings } }), teardown };
try { renderer = createStripedStaircaseRenderer(canvas); } catch (error) { $('renderError').hidden = false; $('renderError').textContent = error.message; }
initWorker(); observer = new ResizeObserver(resize); observer.observe(canvas); resize(); queueField(0); updateControls(); renderFrame = requestAnimationFrame(render);

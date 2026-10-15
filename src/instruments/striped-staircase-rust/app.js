import { STRIPED_STAIRCASE_DEFAULTS, STRIPED_STAIRCASE_VIEWS, advancePingPong,
  cameraFromView, createStaircaseFrame, createStripedStaircaseRenderer, formatComplexCoordinate,
  normalizeStaircaseSettings, panCamera, viewById, zoomCameraAt } from '../striped-staircase/striped-staircase.js';
import { StaircaseEngine } from './engine.js';
import { enhanceRangeKnob } from '../../ui/primitives/range-knob.js';
import { readStaircaseRhythm } from './field.js';

const $ = id => document.getElementById(id);
const descriptions = [
  ['Contour', 'The measured outline becomes a repeating stereo wave. Detail brings out its sharper bends.'],
  ['Harmonics', 'The band’s vertical distribution weights sixteen harmonics. Hold depth to hear the same shape as a sustained spectrum.'],
  ['Stripe rhythm', 'White holds a note for each traced branch; black releases it. Left/right sets pan. Hold freezes the chord or rest.'],
  ['Resonant body', 'Contour length and bends tune and excite a bank of resonances. Body lengthens their response.'],
];
const pitchDescriptions = [
  'Height sets pitch across the selected span. Higher branches sound higher.',
  'X and Y set pitch from the frame center. Moving right or up raises it.',
  'Each tendril remembers its previous note. Turns change pitch; nearby offshoots inherit that history. Lines show the previous-note reference.',
];
const defaults = { progress: .175, direction: 1, speed: .035, baseFrequency: 73, brightness: .55, body: .35,
  level: .48, mode: 2, palette: 3, hold: false, view: 'seahorse', pitchMapping: 1, pitchSpan: 3, voiceLimit: 256 };
const state = { ...defaults, audio: false, playing: false, camera: cameraFromView(viewById('seahorse')),
  settings: normalizeStaircaseSettings(STRIPED_STAIRCASE_DEFAULTS), clock: 0, revision: 0, acceptedRevision: 0,
  audioRevision: 0, ready: false, disposed: false, rhythm: null, audioBranches: 0, audioWhite: false, audioVoices: new Float64Array(0) };
const signalOwner = new AbortController();
const on = (target, name, fn, options = {}) => target.addEventListener(name, fn, { ...options, signal: signalOwner.signal });
const canvas = $('stage'), overlay = $('contourOverlay'), overlayContext = overlay.getContext('2d');
let renderer, worker, field, context, engine, starting = false, audioEpoch = 0, renderFrame = 0, previousTime = 0;
let rebuildTimer = 0, pendingJob = null, workerBusy = false, observer, aspect = 1;
const status = text => { $('liveStatus').textContent = text; };
const keys = ['progress', 'speed', 'baseFrequency', 'brightness', 'body', 'level', 'pitchSpan', 'voiceLimit'];
const structureKeys = ['startIteration', 'maxIterations', 'steps', 'stripePeriod'];
const rangeKnobs = new Map();
let progressGesture = null;
for (const input of document.querySelectorAll('.studies-panel input[type="range"]')) {
  rangeKnobs.set(input.id, enhanceRangeKnob(input));
  // Navigation may have mounted Tap before the instrument module ran.
  input.closest('.mz-tap-tempo-field')?.classList.add('mz-tap-tempo-field--knob');
}
on($('progress'), 'pointerdown', event => {
  if (event.button === 0 && event.isPrimary !== false) progressGesture = event.pointerId;
});
for (const name of ['pointerup', 'pointercancel', 'lostpointercapture']) on($('progress'), name, event => {
  if (event.pointerId === progressGesture) progressGesture = null;
});

function updateControls() {
  for (const key of keys) {
    $(key).value = state[key];
    $(key + 'Out').textContent = key === 'progress' ? state[key].toFixed(3)
      : key === 'speed' ? `${(1 / state.speed).toFixed(1)} s / journey`
      : key === 'pitchSpan' ? `${state.pitchSpan.toFixed(1)} oct`
      : key === 'voiceLimit' ? String(state.voiceLimit)
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
  document.querySelector('label[for="body"] b').textContent = state.mode === 2 ? 'Release' : 'Body';
  $('rhythmReadout').hidden = state.mode !== 2;
  $('pitchControls').hidden = state.mode !== 2;
  $('pitchMapping').value = state.pitchMapping;
  $('pitchDescription').textContent = pitchDescriptions[state.pitchMapping];
  for (const knob of rangeKnobs.values()) knob.update();
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
    pendingJob = { type: 'analyze', revision: state.revision, camera: { ...state.camera }, settings: { ...state.settings }, aspect, resolution: 112, voiceLimit: state.voiceLimit };
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
        status('Ready · Audio, then Play. Hold freezes the current depth.');
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
        state.audioBranches = data.branches; state.audioWhite = data.white;
        state.audioVoices = data.voices;
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
  const rhythm = field?.revision === state.revision ? readStaircaseRhythm(field, state.progress) : null;
  const frame = { ...createStaircaseFrame(state.progress, state.settings, 'slide') };
  // The DSP interpolates prepared depths. The exact nonlinear staircase curve
  // can cross a stripe slightly earlier, so the visible sweep follows the same
  // prepared threshold as the sound instead of running a second depth clock.
  if (rhythm) { frame.renderLow = rhythm.bandLow; frame.renderHigh = rhythm.bandHigh; }
  renderer?.render({ ...frame, stepPhase: .5 }, state.settings, state.camera, state.direction, state.palette);
  overlayContext.clearRect(0, 0, overlay.width, overlay.height);
  state.rhythm = null;
  if (rhythm) {
    state.rhythm = { white: rhythm.white, count: rhythm.count, omitted: rhythm.omitted,
      voices: rhythm.branches.map(({ slot, id, parentId, cx, cy, presence }) => ({ slot, id, parentId, cx, cy, presence })) };
    $('rhythmReadout').textContent = `${rhythm.white ? 'White · on' : 'Black · rest'} · ${rhythm.count} ${rhythm.count === 1 ? 'voice' : 'voices'}${rhythm.omitted ? ` · ${rhythm.omitted} unvoiced` : ''}`;
    const traces = state.mode === 2 ? rhythm.branches : [{ points: field.overlays[Math.round(state.progress * (field.frames - 1))]?.points }];
    for (const branch of traces) {
      const path = branch.points;
      if (!path?.length) continue;
      overlayContext.strokeStyle = state.mode === 2 ? `hsl(${(branch.slot * 137.5 + 115) % 360} 85% 76%)` : '#ddffe6';
      overlayContext.lineWidth = state.mode === 2 && rhythm.white ? 2 : 1.3;
      overlayContext.globalAlpha = state.mode === 2 ? branch.presence * (rhythm.white ? .9 : .4) : .85;
      overlayContext.beginPath();
      for (let i = 0; i < path.length; i += 2) {
        const x = path[i] * overlay.width, y = path[i + 1] * overlay.height;
        if (i === 0) overlayContext.moveTo(x, y); else overlayContext.lineTo(x, y);
      }
      overlayContext.stroke();
      if (state.mode === 2) {
        const at = branch.slot * 6, voices = state.audioVoices;
        if (state.pitchMapping === 2 && state.audioRevision === field.revision && voices[at] === branch.id && voices[at + 4]) {
          const x = voices[at + 2] * overlay.width, y = voices[at + 3] * overlay.height;
          overlayContext.save(); overlayContext.globalAlpha *= .55; overlayContext.setLineDash([3, 4]);
          overlayContext.beginPath(); overlayContext.moveTo(x, y); overlayContext.lineTo(branch.cx * overlay.width, branch.cy * overlay.height); overlayContext.stroke();
          overlayContext.setLineDash([]); overlayContext.beginPath(); overlayContext.arc(x, y, 2, 0, Math.PI * 2); overlayContext.stroke(); overlayContext.restore();
        }
        overlayContext.beginPath(); overlayContext.arc(branch.cx * overlay.width, branch.cy * overlay.height, rhythm.white ? 4 : 3, 0, Math.PI * 2);
        overlayContext.fillStyle = overlayContext.strokeStyle;
        if (rhythm.white) overlayContext.fill(); else overlayContext.stroke();
      }
    }
  } else $('rhythmReadout').textContent = 'Preparing branch traces…';
  overlayContext.globalAlpha = 1;
  if (progressGesture === null) {
    $('progress').value = state.progress;
    rangeKnobs.get('progress').update();
  }
  $('progressOut').textContent = state.progress.toFixed(3);
  $('depthReadout').textContent = `Depth ${frame.renderLow.toFixed(1)}–${frame.renderHigh.toFixed(1)}`;
  $('coordinateReadout').textContent = formatComplexCoordinate(state.camera.centerX, state.camera.centerY);
  renderFrame = requestAnimationFrame(render);
}
function zoom(factor, point = { x: .5, y: .5 }) { state.camera = zoomCameraAt(state.camera, point, factor, aspect); queueField(); }
function resetView() { state.camera = cameraFromView(viewById(state.view)); queueField(); }
function reset() {
  for (const knob of rangeKnobs.values()) knob.cancelGesture();
  progressGesture = null;
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
  if (key === 'progress') seek(value); else {
    state[key] = value; updateControls(); sendControls();
    if (key === 'voiceLimit') queueField();
  }
});
on($('pitchMapping'), 'change', () => { state.pitchMapping = Number($('pitchMapping').value); sendControls(); updateControls(); });
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
  for (const knob of rangeKnobs.values()) knob.destroy();
  rangeKnobs.clear(); progressGesture = null;
  signalOwner.abort(); pointers.clear(); void closeAudio();
}
on(window, 'pagehide', teardown);
window.addEventListener('pageshow', event => { if (event.persisted && state.disposed) location.reload(); });
globalThis.__staircaseStudies = { snapshot: () => ({ ...state, camera: { ...state.camera }, settings: { ...state.settings } }), teardown };
try { renderer = createStripedStaircaseRenderer(canvas); } catch (error) { $('renderError').hidden = false; $('renderError').textContent = error.message; }
initWorker(); observer = new ResizeObserver(resize); observer.observe(canvas); resize(); queueField(0); updateControls(); renderFrame = requestAnimationFrame(render);

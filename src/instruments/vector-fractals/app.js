import { MODES, PRESETS, sanitizeState, randomizeState, clamp, wrap, juliaParameter } from './model.js';
import { VectorRenderer } from './renderer.js';
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
const modeMemory = new Map(), fields = new Map(), knobs = [];
const abort = new AbortController();
const listen = (node, name, callback, options = {}) => node.addEventListener(name, callback, { ...options, signal: abort.signal });
const status = message => { $('status').textContent = message; };
const renderer = new VectorRenderer($('stage'), $('waveforms'), $('parameterMap'));
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
      status(armed ? (playing ? 'Playing · shared XY oscillator' : 'Audio on · press Play') : 'Ready · enable Audio, then Play');
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
  queued = { id: ++request, state }; $('stage').dataset.building = 'true';
  clearTimeout(buildTimer); buildTimer = setTimeout(sendQueued, 35);
}

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
  ['pitch', 'Pitch', 25, 1200, 1, v => `${v.toFixed(0)} Hz`, 'soundKnobs'],
  ['rotation', 'Rotation', -180, 180, 1, v => `${v.toFixed(0)}°`, 'soundKnobs'],
];
for (const [key, label, min, max, step, format, host] of parameters) {
  const field = createRangeField({ id: key, label, min, max, step, value: state[key], format,
    onInput: value => update({ [key]: value }),
  });
  $(host).append(field); knobs.push(enhanceRangeKnob(field.input, { scale: key === 'pitch' ? 'log' : 'linear' })); fields.set(key, field);
}
for (const key of ['shape', 'component', 'traversal', 'readout']) listen($(key), 'change', () => update({ [key]: $(key).value }));
for (const key of ['vectors', 'reference']) listen($(key), 'change', () => update({ [key]: $(key).checked }));

const presets = registerHeaderPresets({ id: 'vector-fractals', presets: PRESETS, host: $('mainPresets'),
  capture: () => ({ ...state }), apply: snapshot => { state = sanitizeState(snapshot); sync(); build(); audio.send({ type: 'state', state }); },
  randomize: (snapshot, random) => randomizeState(snapshot, random),
});

function sync() {
  const mode = MODES.find(m => m.id === state.mode);
  document.body.style.setProperty('--vector-accent', mode.color);
  $('stage').dataset.mode = state.mode;
  for (const button of $('demoModes').children) button.setAttribute('aria-pressed', String(button.dataset.mode === state.mode));
  for (const [key, field] of fields) field.setValue(state[key]);
  for (const key of ['shape', 'component', 'traversal', 'readout']) $(key).value = state[key];
  for (const key of ['vectors', 'reference']) $(key).checked = state[key];
  $('shapeField').hidden = state.mode !== 'julia'; $('componentField').hidden = state.mode !== 'voyager';
  const exploratory = state.mode === 'voyager' || (state.mode === 'julia' && state.shape === 'cardioid');
  fields.get('depth').hidden = !exploratory; fields.get('angle').hidden = !exploratory;
  fields.get('speed').hidden = state.mode !== 'voyager';
  $('mapLabel').textContent = state.mode === 'mandelbrot' ? 'Cardioid + period-two bulb' : 'Julia parameter c';
  $('demoDescription').textContent = {
    julia: 'Counter-rotating vectors make a Julia contour. The same curve is the waveform.',
    mandelbrot: 'A contour around the whole Mandelbrot set. Move closer to reveal its structure.',
    voyager: 'A moving Mandelbrot parameter continuously reshapes the Julia oscillator.',
  }[state.mode];
  history.replaceState(null, '', `#${state.mode}`);
  presets?.refresh();
}
function update(patch) {
  state = sanitizeState({ ...state, ...patch }); sync(); audio.send({ type: 'state', state });
  if (Object.keys(patch).some(k => !['pitch', 'rotation', 'speed', 'readout', 'vectors', 'reference'].includes(k))) build();
}
function switchMode(mode) {
  if (!MODES.some(m => m.id === mode) || mode === state.mode) return;
  modeMemory.set(state.mode, { ...state });
  state = { ...(modeMemory.get(mode) ?? PRESETS.find(p => p.snapshot.mode === mode).snapshot) };
  sync(); audio.send({ type: 'state', state }); build();
}
function setPlaying(value) {
  playing = value; audio.send({ type: 'playing', value });
  $('playButton').setAttribute('aria-pressed', String(value)); $('playButton').setAttribute('aria-label', value ? 'Pause' : 'Play');
  $('playIcon').setAttribute('d', value ? 'M6 5H10V19H6ZM14 5H18V19H14Z' : 'M8 5 19 12 8 19Z');
  $('transportState').textContent = value ? (armed ? 'Playing' : 'Preview · audio off') : 'Paused';
  status(armed ? (value ? 'Playing · shared XY oscillator' : 'Audio on · paused') : 'Audio off · visual preview only');
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
    await audio.start({ state, bank, level, playing, scanPhase, voyage });
    if (disposed) return;
    // Edits and Play while loading must win over the initial snapshot.
    audio.send({ type: 'state', state }); audio.send({ type: 'bank', bank });
    audio.send({ type: 'playing', value: playing }); audio.send({ type: 'level', value: level });
    armed = true; strip.setAudioState('on'); setPlaying(playing);
  } catch (error) { armed = false; strip.setAudioState('error'); status(`Audio could not start: ${error.message}`); }
  finally { starting = false; }
}

listen($('playButton'), 'click', () => setPlaying(!playing));
listen($('reset'), 'click', () => {
  state = { ...PRESETS.find(p => p.snapshot.mode === state.mode).snapshot };
  scanPhase = 0; voyage = 0; telemetry = null;
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
    voyage = wrap(telemetry.voyage + (state.mode === 'voyager' ? elapsed * state.speed : 0));
  } else if (playing && !armed) {
    scanPhase = wrap(scanPhase + dt * state.pitch / 256);
    if (state.mode === 'voyager') voyage = wrap(voyage + dt * state.speed);
  }
  if (time - lastPaint > 1000 / 30 && !document.hidden) {
    lastPaint = time;
    renderer.draw(bank, state, { scanPhase, voyage, frequency: armed && telemetry ? telemetry.frequency : state.pitch,
      rotation: armed && telemetry ? telemetry.rotation : state.rotation * Math.PI / 180, sampleRate: audio.context?.sampleRate ?? 48000 });
  }
  frameId = requestAnimationFrame(frame);
}

export function diagnosticSnapshot() {
  return { state: { ...state }, playing, armed, starting, ready: Boolean(bank), building: busy || Boolean(queued),
    frames: bank?.frames.length ?? 0, voyage, scanPhase, c: bank ? juliaParameter(bank.state, voyage) : null,
    audioTime: audio.context?.currentTime ?? null, renderer: renderer.gl ? 'webgl' : 'canvas', disposed };
}
export async function dispose() {
  if (disposed) return; disposed = true; cancelAnimationFrame(frameId); clearTimeout(buildTimer); abort.abort();
  worker.terminate(); presets.destroy(); strip.destroy(); for (const knob of knobs) knob.destroy();
  for (const field of fields.values()) field.destroy(); renderer.destroy(); await audio.destroy();
}
// Leave a back/forward-cache document intact; real navigation tears down resources.
listen(window, 'pagehide', event => { if (!event.persisted) void dispose(); });
sync(); build(); frameId = requestAnimationFrame(frame);

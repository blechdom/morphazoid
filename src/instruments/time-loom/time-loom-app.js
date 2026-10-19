import { createAudioStrip } from '../../ui/patterns/audio-strip.js';
import { mountAudioInputControl } from '../../audio-input-control.js';
import { audioInputConstraints, configureAudioInputNode } from '../../audio-input-settings.js';
import { registerHeaderPresets } from '../../site/header-presets.js';
import { createDefaultState, normalizeState, createDemo, getWaveform, advanceTransport } from './time-loom-model.js';
import { TimeLoomAudio } from './time-loom-audio.js';
import { drawTimeLoom, getLoomLayout, hitTestLoom } from './time-loom-renderer.js';
import { TIME_LOOM_PRESETS, validateTimeLoomPreset, randomizeTimeLoomPreset } from './time-loom-presets.js';

const $ = id => document.getElementById(id);
const abort = new AbortController();
const on = (target, type, handler, options = {}) => target.addEventListener(type, handler, { ...options, signal: abort.signal });
const letters = ['A', 'B', 'C'];
const clone = value => JSON.parse(JSON.stringify(value));
let cords = createDefaultState().cords;
let selected = 0, playing = false, armed = false, starting = false, disposed = false, audioReady = false;
let preview = { cords, activeCord: 0, position: cords[0].start, playing: false };
let audioAttempt = 0, sourceAttempt = 0, micAttempt = 0;
let stream = null, micSource = null, inputGain = null, micPending = false;
let recording = null, decoding = false, drag = null, linkFrom = null, rangeEditing = false;
let width = 600, height = 500, frame = 0, lastFrame = performance.now(), lastPaint = 0;
const history = [];
const demo = source(createDemo(48000), 48000, 'Original study');
let sources = [demo, demo, demo];
const audio = new TimeLoomAudio({ onState: snapshot => { if (!disposed && audioReady) preview = snapshot; },
  onError: error => { audioReady = armed = starting = false; strip.setAudioState('off'); showError(error); } });
const strip = createAudioStrip({ buttonId: 'audioButton', levelId: 'level', level: .55,
  onAudioClick: toggleAudio, onLevelInput: value => audio.setVolume(value) });
$('audioSlot').replaceWith(strip);
const mic = mountAudioInputControl({ container: $('inputControl'), onStart: startMic, onStop: stopMic,
  onGainInput: value => inputGain?.gain.setTargetAtTime(value, audio.context.currentTime, .015),
  getState: () => ({ active: Boolean(stream), pending: micPending }),
  getSignal: () => ({ node: inputGain, stream }),
});
const canvas = $('loom'), ctx = canvas.getContext('2d');
audio.setState({ cords });
sources.forEach((s, i) => audio.setSource(i, s.samples, s.rate));
audio.setVolume(strip.level);

function source(samples, rate, name) {
  return { samples, rate, name, duration: samples.length / rate, waveform: getWaveform(samples, 128) };
}
function say(message) { if (!disposed) $('liveStatus').textContent = message; }
function showError(error) {
  if (disposed) return;
  $('audioError').hidden = false;
  $('audioError').textContent = error?.name === 'NotAllowedError' ? 'Microphone access was not allowed. You can load a file or play the demo.' : error?.message || String(error);
}
function checkpoint() {
  pushHistory({ cords: clone(cords), sources: sources.slice(), selected });
}
function pushHistory(snapshot) {
  history.push(snapshot);
  if (history.length > 8) history.shift();
}
function sync() {
  cords = normalizeState({ cords }).cords;
  audio.setState({ cords }); preview.cords = cords;
  const c = cords[preview.activeCord];
  preview.position = Math.max(c.start, Math.min(c.end, preview.position));
  presets?.refresh(); renderControls();
}
function edit(change, save = true) { if (save) checkpoint(); change(); sync(); }
function enter(index = selected, position) {
  const c = cords[index];
  const p = Math.max(c.start, Math.min(c.end, position ?? (c.reverse ? c.end : c.start)));
  preview = { ...preview, activeCord: index, position: p }; audio.seek(index, p);
  say(`Reading cord ${letters[index]}${armed ? '.' : ' · Audio is off.'}`);
}
function select(index) {
  selected = index;
  if (linkFrom !== null && index !== linkFrom) {
    const from = linkFrom; edit(() => { cords[from].next = index; }); linkFrom = null;
    say(`Tied ${letters[from]} to ${letters[index]}. The bead will cross at the last knot.`);
  }
  renderControls();
}
function setPlaying(value) {
  playing = value; preview.playing = value; audio.setPlaying(value); renderControls();
  say(value ? armed ? 'Reading the weave.' : 'The weave is moving. Turn Audio on to hear it.' : 'Paused. Your place is held.');
}
async function ensureAudio() {
  const needsSync = !audioReady || audio.context?.state !== 'running';
  await audio.init();
  if (disposed) return;
  if (needsSync) audio.seek(preview.activeCord, preview.position);
  audioReady = true;
  audio.setPlaying(playing);
}
async function toggleAudio() {
  const attempt = ++audioAttempt; $('audioError').hidden = true;
  if (armed || starting) {
    armed = starting = false; audio.setArmed(false); strip.setAudioState('off');
    say(playing ? 'Audio off. The weave keeps its place in time.' : 'Audio off.'); return;
  }
  starting = true; strip.setAudioState('starting');
  try {
    await ensureAudio();
    if (disposed || attempt !== audioAttempt) return;
    armed = true; starting = false; audio.setArmed(true); strip.setAudioState('on');
    say(playing ? 'Audio on. Reading the weave.' : 'Audio on. Press Play to read the weave.');
  } catch (error) {
    if (attempt !== audioAttempt || disposed) return;
    starting = armed = false; strip.setAudioState('off'); showError(error);
  }
}
async function startMic() {
  if (stream || disposed) return;
  const attempt = ++micAttempt; micPending = true;
  try {
    await ensureAudio();
    if (disposed || attempt !== micAttempt) return;
    if (!navigator.mediaDevices?.getUserMedia) throw new Error('Microphone capture needs HTTPS or localhost. Load audio or use the demo here.');
    const acquired = await navigator.mediaDevices.getUserMedia(audioInputConstraints());
    if (disposed || attempt !== micAttempt) { acquired.getTracks().forEach(track => track.stop()); return; }
    stream = acquired; micSource = audio.context.createMediaStreamSource(stream);
    inputGain = configureAudioInputNode(mic.createGain(audio.context)); micSource.connect(inputGain);
    for (const track of stream.getTracks()) on(track, 'ended', () => { if (stream === acquired) { stopMic(); say('Microphone disconnected. Previous phrases are kept.'); } });
    say('Microphone ready. Record phrase captures up to 30 seconds.');
  } catch (error) {
    if (attempt === micAttempt) stopMic();
    throw error;
  } finally { if (attempt === micAttempt) micPending = false; renderControls(); }
}
function stopMic() {
  micAttempt++; micPending = false; cancelRecording();
  micSource?.disconnect(); micSource = null;
  inputGain?.disconnect(); inputGain = null;
  stream?.getTracks().forEach(track => track.stop()); stream = null;
  if (!disposed) renderControls();
}
function targets() { return $('captureTarget').value === 'all' ? [0, 1, 2] : [selected]; }
function install(nextSource, indices) {
  $('audioError').hidden = true;
  checkpoint();
  for (const index of indices) { sources[index] = nextSource; audio.setSource(index, nextSource.samples, nextSource.rate); }
  renderControls();
  say(`${nextSource.name} remembered on ${indices.length === 3 ? 'all three cords' : `cord ${letters[indices[0]]}`}.`);
}
async function decode(data, name, indices, attempt) {
  if (disposed || attempt !== sourceAttempt) return;
  decoding = true; renderControls();
  try {
    const context = new OfflineAudioContext(1, 1, 48000);
    const buffer = await context.decodeAudioData(data);
    if (disposed || attempt !== sourceAttempt) return;
    const length = Math.min(buffer.length, Math.floor(buffer.sampleRate * 30));
    if (length < buffer.sampleRate * .08) throw new Error('That phrase is too short. Record at least a tenth of a second.');
    const samples = new Float32Array(length);
    for (let c = 0; c < buffer.numberOfChannels; c++) {
      const channel = buffer.getChannelData(c);
      for (let i = 0; i < length; i++) samples[i] += channel[i] / buffer.numberOfChannels;
    }
    install(source(samples, buffer.sampleRate, name), indices);
    if (buffer.duration > 30) say(`${name}: the first 30 seconds are on the cords.`);
  } catch (error) { if (!disposed && attempt === sourceAttempt) showError(error); }
  finally { if (!disposed && attempt === sourceAttempt) { decoding = false; renderControls(); } }
}
async function checkFileDuration(file) {
  const media = document.createElement('audio'), url = URL.createObjectURL(file);
  try {
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Could not read this file. Try a short WAV, MP3 or M4A.')), 10000);
      media.onloadedmetadata = () => { clearTimeout(timer); resolve(); };
      media.onerror = () => { clearTimeout(timer); reject(new Error('This audio file could not be opened.')); };
      media.preload = 'metadata'; media.src = url;
    });
    if (!Number.isFinite(media.duration) || media.duration > 180) throw new Error('Choose a phrase under 3 minutes; the first 30 seconds will be used.');
  } finally { media.onloadedmetadata = media.onerror = null; media.removeAttribute('src'); media.load(); URL.revokeObjectURL(url); }
}
function releaseTake(take) {
  clearTimeout(take.timer);
  try { inputGain?.disconnect(take.destination); } catch { /* input already detached */ }
  take.destination.stream.getTracks().forEach(track => track.stop());
}
function cancelRecording() {
  sourceAttempt++; decoding = false;
  const take = recording; recording = null;
  if (take) { take.cancelled = true; if (take.recorder.state !== 'inactive') take.recorder.stop(); releaseTake(take); }
}
function recordPhrase() {
  if (recording) { finishRecording(recording); return; }
  if (!stream || !inputGain) { say('Turn on the microphone in the input controls, then Record phrase.'); mic.button.focus(); return; }
  if (!globalThis.MediaRecorder) { showError(new Error('Recording is unavailable in this browser. Load an audio file instead.')); return; }
  $('audioError').hidden = true;
  const destination = audio.context.createMediaStreamDestination(); inputGain.connect(destination);
  let recorder;
  try { recorder = new MediaRecorder(destination.stream); }
  catch (error) { inputGain.disconnect(destination); destination.stream.getTracks().forEach(track => track.stop()); showError(error); return; }
  const take = { recorder, destination, chunks: [], indices: targets(), attempt: ++sourceAttempt, started: performance.now(), cancelled: false };
  recording = take;
  recorder.ondataavailable = event => { if (event.data.size && !take.cancelled) take.chunks.push(event.data); };
  recorder.onerror = event => { cancelRecording(); showError(event.error || new Error('Recording failed. Previous phrases are kept.')); renderControls(); };
  recorder.onstop = async () => {
    if (recording === take) recording = null;
    releaseTake(take);
    if (disposed || take.cancelled || take.attempt !== sourceAttempt) return;
    const blob = new Blob(take.chunks, { type: recorder.mimeType });
    say('Remembering your phrase…');
    await decode(await blob.arrayBuffer(), 'Recorded phrase', take.indices, take.attempt);
  };
  try { recorder.start(250); }
  catch (error) { cancelRecording(); showError(error); renderControls(); return; }
  take.timer = setTimeout(() => finishRecording(take), 30000);
  say('Recording. Press Finish phrase when you are ready.'); renderControls();
}
function finishRecording(take) {
  if (take.recorder.state !== 'recording') return;
  take.finishing = true; take.recorder.stop(); renderControls();
}

function renderControls() {
  if (disposed) return;
  const c = cords[selected], s = sources[selected];
  $('playButton').textContent = playing ? 'Ⅱ Pause' : '▶ Play'; $('playButton').setAttribute('aria-pressed', String(playing));
  $('undoButton').disabled = !history.length || Boolean(recording) || decoding;
  for (const button of $('cordSelector').children) button.setAttribute('aria-pressed', String(Number(button.dataset.cord) === selected));
  for (const key of ['start', 'end', 'stretch']) $(key).value = c[key];
  $('startOut').value = `${(c.start * s.duration).toFixed(2)} s`;
  $('endOut').value = `${(c.end * s.duration).toFixed(2)} s`;
  $('stretchOut').value = `${c.stretch.toFixed(2)}×`;
  $('passageDuration').textContent = `${((c.end - c.start) * s.duration * c.stretch).toFixed(2)} s`;
  $('reverseButton').textContent = c.reverse ? '↑ Read upward' : '↓ Read downward'; $('reverseButton').setAttribute('aria-pressed', String(c.reverse));
  $('nextCord').value = c.next === null ? '' : String(c.next);
  for (const option of $('nextCord').options) option.hidden = option.value === String(selected);
  $('tieButton').setAttribute('aria-pressed', String(linkFrom !== null)); $('tieButton').textContent = linkFrom === null ? 'Tie to another cord' : 'Cancel tie';
  $('untieButton').disabled = c.next === null;
  $('sourceLabel').textContent = `Cord ${letters[selected]} · ${s.name} · ${s.duration.toFixed(1)} s`;
  $('phraseLabel').textContent = `${s.name} · ${s.duration.toFixed(1)} s`;
  $('recordPhrase').textContent = recording ? '■ Finish phrase' : '● Record phrase'; $('recordPhrase').setAttribute('aria-pressed', String(Boolean(recording)));
  $('recordPhrase').disabled = decoding || Boolean(recording?.finishing); $('loadButton').disabled = $('demoButton').disabled = $('copyButton').disabled = Boolean(recording) || decoding;
  $('captureTarget').disabled = Boolean(recording) || decoding;
  if (!recording) $('recordClock').textContent = '';
}
function beginTie() { linkFrom = linkFrom === null ? selected : null; say(linkFrom === null ? 'Tie cancelled.' : `Choose another cord to tie after ${letters[selected]}.`); renderControls(); }
on($('playButton'), 'click', () => setPlaying(!playing));
on($('cordSelector'), 'click', event => { const button = event.target.closest('[data-cord]'); if (button) select(Number(button.dataset.cord)); });
on($('reverseButton'), 'click', () => edit(() => { cords[selected].reverse = !cords[selected].reverse; }));
on($('enterButton'), 'click', () => enter());
on($('tieButton'), 'click', beginTie);
on($('untieButton'), 'click', () => { edit(() => { cords[selected].next = null; }); say(`Untied cord ${letters[selected]}. Its own passage loops again.`); });
on($('nextCord'), 'change', event => edit(() => { cords[selected].next = event.target.value === '' ? null : Number(event.target.value); }));
on($('undoButton'), 'click', () => {
  const previous = history.pop(); if (!previous) return;
  sourceAttempt++; decoding = false; linkFrom = null;
  cords = previous.cords; selected = previous.selected;
  previous.sources.forEach((s, i) => { if (s !== sources[i]) audio.setSource(i, s.samples, s.rate); });
  sources = previous.sources; sync(); say('Brought back the previous weave.');
});
on($('resetButton'), 'click', () => {
  cancelRecording(); linkFrom = null;
  edit(() => { cords = createDefaultState().cords; selected = 0; }); enter(0); say('Original passages restored. Your recordings are kept.');
});
for (const key of ['start', 'end', 'stretch']) {
  on($(key), 'input', event => {
    if (!rangeEditing) { checkpoint(); rangeEditing = true; }
    const value = Number(event.target.value), c = cords[selected];
    c[key] = key === 'start' ? Math.min(value, c.end - .02) : key === 'end' ? Math.max(value, c.start + .02) : value;
    sync();
  });
  on($(key), 'change', () => { rangeEditing = false; });
  on($(key), 'blur', () => { rangeEditing = false; });
}
on($('recordPhrase'), 'click', recordPhrase);
on($('loadButton'), 'click', () => $('audioFile').click());
on($('audioFile'), 'change', async () => {
  const file = $('audioFile').files[0]; $('audioFile').value = ''; if (!file) return;
  if (file.size > 40 * 1024 * 1024) { showError(new Error('Choose an audio file smaller than 40 MB.')); return; }
  const indices = targets(), attempt = ++sourceAttempt;
  decoding = true; renderControls(); say('Loading your phrase…');
  try {
    await checkFileDuration(file);
    if (disposed || attempt !== sourceAttempt) return;
    await decode(await file.arrayBuffer(), file.name.slice(0, 100), indices, attempt);
  }
  catch (error) { if (attempt === sourceAttempt) { decoding = false; showError(error); renderControls(); } }
});
on($('copyButton'), 'click', () => install(sources[selected], [0, 1, 2]));
on($('demoButton'), 'click', () => { sourceAttempt++; install(demo, targets()); });

function pointer(event) { const r = canvas.getBoundingClientRect(); return { x: event.clientX - r.left, y: event.clientY - r.top }; }
on(canvas, 'pointerdown', event => {
  if (event.button !== 0 || drag) return;
  const point = pointer(event), layout = getLoomLayout(width, height, cords), hit = hitTestLoom(layout, point.x, point.y);
  if (!hit) return;
  event.preventDefault(); canvas.focus({ preventScroll: true }); canvas.setPointerCapture(event.pointerId);
  if (linkFrom !== null) { select(hit.cord); return; }
  selected = hit.cord; renderControls();
  if (hit.part === 'link') { linkFrom = hit.cord; renderControls(); return; }
  const before = clone(cords), saved = hit.part !== 'cord';
  drag = { ...hit, ...point, id: event.pointerId, origin: point, before, saved, layout: layout[hit.cord], moved: false };
  if (hit.part === 'cord') enter(hit.cord, (point.y - drag.layout.top) / drag.layout.length);
});
on(canvas, 'pointermove', event => {
  const point = pointer(event);
  if (!drag || drag.id !== event.pointerId) { canvas.style.cursor = hitTestLoom(getLoomLayout(width, height, cords), point.x, point.y) ? 'grab' : 'default'; return; }
  Object.assign(drag, point); drag.moved ||= Math.hypot(point.x - drag.origin.x, point.y - drag.origin.y) > 4;
  const c = cords[drag.cord], g = drag.layout;
  if (drag.part === 'start') c.start = Math.max(0, Math.min(c.end - .02, drag.before[drag.cord].start + (point.y - drag.origin.y) / g.length));
  if (drag.part === 'end') c.end = Math.min(1, Math.max(c.start + .02, drag.before[drag.cord].end + (point.y - drag.origin.y) / g.length));
  if (drag.part === 'stretch') c.stretch = Math.max(.5, Math.min(4, drag.before[drag.cord].stretch * 2 ** ((point.y - drag.origin.y) / Math.max(32, g.availableLength * .14))));
  if (drag.part === 'cord') enter(drag.cord, (point.y - g.top) / g.length);
  else sync();
});
function finishPointer(event, cancel = false) {
  if (!drag || drag.id !== event.pointerId) return;
  if (cancel && drag.saved) { cords = drag.before; sync(); }
  else if (drag.saved && JSON.stringify(cords) !== JSON.stringify(drag.before)) {
    pushHistory({ cords: drag.before, sources: sources.slice(), selected });
  }
  drag = null; if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
  renderControls();
}
on(canvas, 'pointerup', event => finishPointer(event));
on(canvas, 'pointercancel', event => finishPointer(event, true));
on(canvas, 'lostpointercapture', event => finishPointer(event, true));
on(canvas, 'dblclick', event => {
  const p = pointer(event), layout = getLoomLayout(width, height, cords), hit = hitTestLoom(layout, p.x, p.y); if (!hit) return;
  selected = hit.cord;
  edit(() => {
    const c = cords[selected];
    if (hit.part === 'stretch') c.reverse = !c.reverse;
    else if (hit.part === 'link') c.next = null;
    else { const middle = Math.max(.03, Math.min(.97, (p.y - layout[selected].top) / layout[selected].length)); c.start = middle - .03; c.end = middle + .03; }
  });
});
on(canvas, 'keydown', event => {
  if (event.altKey || event.ctrlKey || event.metaKey) return;
  if (/^[123]$/.test(event.key)) { event.preventDefault(); select(Number(event.key) - 1); return; }
  const key = event.key.toLowerCase(), c = cords[selected];
  if (!['arrowup', 'arrowdown', 'arrowleft', 'arrowright', 'r', 't', 'escape', 'enter'].includes(key)) return;
  event.preventDefault();
  if (key === 'escape') { linkFrom = null; renderControls(); return; }
  if (key === 'enter') { enter(); return; }
  if (key === 't') { if (!event.repeat) beginTie(); return; }
  if (key === 'r' && event.repeat) return;
  edit(() => {
    if (key === 'r' && !event.repeat) c.reverse = !c.reverse;
    if (key === 'arrowleft' || key === 'arrowright') c.stretch = Math.max(.5, Math.min(4, c.stretch + (key === 'arrowleft' ? -.05 : .05)));
    const d = key === 'arrowup' ? -.01 : key === 'arrowdown' ? .01 : 0;
    if (d && event.shiftKey) c.end = Math.max(c.start + .02, Math.min(1, c.end + d));
    else if (d) c.start = Math.max(0, Math.min(c.end - .02, c.start + d));
  });
});

const presets = registerHeaderPresets({ id: 'time-loom', presets: TIME_LOOM_PRESETS,
  capture: () => ({ cords: clone(cords) }),
  apply: snapshot => { const clean = validateTimeLoomPreset(snapshot); checkpoint(); cords = clean.cords; linkFrom = null; sync(); },
  randomize: randomizeTimeLoomPreset,
});
function resize() {
  const bounds = canvas.getBoundingClientRect(); width = bounds.width; height = bounds.height;
  const dpr = Math.min(2, devicePixelRatio || 1);
  canvas.width = Math.round(width * dpr); canvas.height = Math.round(height * dpr); ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}
const observer = new ResizeObserver(resize); observer.observe(canvas);
function animate(now) {
  if (disposed) return;
  const elapsed = Math.min(.1, (now - lastFrame) / 1000); lastFrame = now;
  if (playing && (!audioReady || audio.context?.state !== 'running')) preview = advanceTransport({ ...preview, cords, playing }, elapsed, sources.map(s => s.duration));
  if (!document.hidden && now - lastPaint > 1000 / 30) {
    drawTimeLoom(ctx, width, height, { cords, selected, activeCord: preview.activeCord, position: preview.position, playing, armed,
      waveforms: sources.map(s => s.waveform), durations: sources.map(s => s.duration), linkFrom, drag });
    $('readerLabel').textContent = `${playing ? 'Reading' : 'Held at'} ${letters[preview.activeCord]} · ${(preview.position * sources[preview.activeCord].duration).toFixed(2)} s`;
    const c = cords[preview.activeCord]; $('routeLabel').textContent = `${letters[preview.activeCord]} ${c.reverse ? '↑' : '↓'} ${c.next === null ? '↻' : `→ ${letters[c.next]}`}`;
    if (recording) $('recordClock').textContent = `${((now - recording.started) / 1000).toFixed(1)} / 30 s`;
    lastPaint = now;
  }
  frame = requestAnimationFrame(animate);
}
on(document, 'visibilitychange', () => { if (document.hidden) { stopMic(); armed = starting = false; audioAttempt++; audio.setArmed(false); strip.setAudioState('off'); } });
function dispose(event) {
  if (event?.persisted) { stopMic(); armed = starting = false; audioAttempt++; audio.setArmed(false); strip.setAudioState('off'); return; }
  if (disposed) return;
  disposed = true; audioAttempt++; stopMic(); abort.abort(); cancelAnimationFrame(frame); observer.disconnect(); mic.destroy(); presets.destroy(); strip.destroy(); void audio.dispose();
}
on(window, 'pagehide', dispose);
// Read-only mechanical diagnostics: do not expose mutable buffers or audio nodes.
window.timeLoom = Object.freeze({ snapshot: () => ({ cords: clone(cords), selected, playing, armed, recording: Boolean(recording),
  activeCord: preview.activeCord, position: preview.position, durations: sources.map(s => s.duration), sourceNames: sources.map(s => s.name), canUndo: history.length > 0 }) });
resize(); renderControls(); frame = requestAnimationFrame(animate);

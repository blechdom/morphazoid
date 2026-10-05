import { MAX_BLOBS, MAX_POINTS, COLORS, clamp, distance, cleanPoints, buildPath, demoBlobs, normalizeScene } from './model.js';
import { defaultParameters, normalizeParams, performanceState } from './parameters.js';
import { buildPerformancePath, rotatePath, transformAnchor, inverseAnchor } from './paths.js';
import { BLOB_PRESETS, randomizeBlobs } from './presets.js';
import { handles, insertPoint, removePoint, smoothPoint, nearestSegment } from './vector.js';
import { expandPaths, reflectionTransforms, reflectPoint, unreflectPoint, rotateUnitPoint } from './symmetry.js';
import { mountBlobsControls } from './controls.js';
import { createShapeReaderModel } from '../../families/geometry-presets/shape-readers.js';
import { createShapeSoundModel } from '../../families/geometry-presets/shape-sound.js';
import { registerHeaderPresets } from '../../site/header-presets.js';
import { rebaseContinuousPosition, rebasePingPongPosition } from '../../articulation.js';
import { wrap01 } from '../../geometry.js';
import { connectAudioOutput } from '../../audio-output-manager.js';
import { resumeAudioContext, withAudioTimeout } from '../../audio-startup.js';
import { canvasSizing } from '../../graphics/canvas-sizing.js';

const $ = id => document.getElementById(id);
const canvas = $('stage'), context = canvas.getContext('2d');
const events = new AbortController();
const on = (target, type, callback) => target.addEventListener(type, callback, { signal: events.signal });
const STORAGE_KEY = 'morphazoid:blobs:v3';
let scene = { version: 3, blobs: demoBlobs(), params: defaultParameters() };
try { scene = normalizeScene(JSON.parse(localStorage.getItem(STORAGE_KEY) ?? localStorage.getItem('morphazoid:blobs:v2') ?? localStorage.getItem('morphazoid:blobs:v1'))) ?? scene; } catch { /* Storage is optional. */ }
scene.params.autoRotate = false;
let selected = 0, selectedPoint = 0, selectedCopy = 'identity', basePaths = [], paths = [], tool = 'edit', draft = [], drag = null, undo = [], redo = [];
let hover = null, lastEditAudio = -Infinity;
let audioContext = null, node = null, master = null, releaseOutput = null;
let armed = false, wanted = false, starting = false, disposed = false, usingAudioClock = false;
let clock = { phase: 0, time: performance.now() / 1000, playing: false, rotationPhase: 0, rotating: false };
let frame = 0, width = 1, height = 1, ratio = 1, stageSize = 1, offsetX = 0, offsetY = 0;
let lastDrawAt = -Infinity, lastReadoutAt = -Infinity, drawCost = 0;
let cursor = { x: .5, y: .5 }, keyboardCursor = false;
const now = () => usingAudioClock && audioContext ? audioContext.currentTime : performance.now() / 1000;
const liveState = (time = now()) => performanceState(scene.params, clock, time);
let controls = null, presetController = null;
const snapshot = () => JSON.stringify(scene);
const announce = text => { $('drawStatus').textContent = text; };
const save = () => { try { localStorage.setItem(STORAGE_KEY, snapshot()); } catch { /* Private browsing remains playable. */ } };
function remember(previous = snapshot()) { undo.push(previous); if (undo.length > 30) undo.shift(); redo = []; }
function syncAudio() { node?.port.postMessage({ type: 'scene', params: scene.params, paths, clock }); }
function changeClockSource(audio) {
  const before = liveState(); usingAudioClock = audio;
  clock = { ...clock, phase: before.continuousPosition, rotationPhase: before.continuousRotation, time: now() }; syncAudio();
}
function rebuild() {
  basePaths = scene.blobs.map(blob => buildPerformancePath(blob, scene.params));
  paths = expandPaths(basePaths, scene.params.reflectionAxes);
  selected = Math.max(0, Math.min(selected, scene.blobs.length - 1));
  selectedPoint = Math.min(selectedPoint, (scene.blobs[selected]?.points.length ?? 1) - 1);
  syncAudio(); refresh(); save();
}
function refresh() {
  controls?.refresh(liveState()); presetController?.refresh();
  $('undo').disabled = !undo.length && !draft.length;
  $('redo').disabled = !redo.length;
  $('deletePoint').disabled = tool !== 'edit' || (scene.blobs[selected]?.points.length ?? 0) <= 3;
  $('insertPoint').disabled = tool !== 'edit' || !scene.blobs.length || scene.blobs[selected].points.length >= MAX_POINTS;
  $('pointSelection').textContent = scene.blobs.length ? `Point ${selectedPoint + 1} of ${scene.blobs[selected].points.length}` : 'No point selected';
  for (const button of document.querySelectorAll('[data-reflection-axis]')) button.setAttribute('aria-pressed', String(scene.params.reflectionAxes.includes(button.dataset.reflectionAxis)));
  const copies = reflectionTransforms(scene.params.reflectionAxes).length;
  $('symmetryCount').textContent = `${copies} ${copies === 1 ? 'copy' : 'linked copies'}`;
  $('clearSymmetry').disabled = copies === 1;
  $('closePath').disabled = draft.length < 3;
  $('cancelPath').disabled = !draft.length;
  $('deleteBlob').disabled = !scene.blobs.length;
  $('clearAll').disabled = !scene.blobs.length && !draft.length;
  $('cornerPoint').disabled = !scene.blobs.length || tool !== 'edit';
  $('smoothPoint').disabled = !scene.blobs.length || tool !== 'edit';
  const options = scene.blobs.map((_, i) => new Option(`Blob ${i + 1}`, i, false, i === selected));
  $('selectedBlob').replaceChildren(...(options.length ? options : [new Option('No blobs', '')]));
  $('selectedBlob').disabled = !options.length;
}
function rebase() {
  const before = liveState();
  clock = { ...clock, phase: before.continuousPosition, rotationPhase: before.continuousRotation, time: now() };
  return before;
}
function changeParameters(patch) {
  if (drag) cancelGesture();
  const before = rebase(), previous = scene.params;
  scene.params = normalizeParams({ ...scene.params, ...patch });
  if (previous.motionMode !== scene.params.motionMode) clock.phase = scene.params.motionMode === 'pingpong'
    ? rebasePingPongPosition(before.continuousPosition, before.position)
    : rebaseContinuousPosition(before.continuousPosition, wrap01(before.continuousPosition), before.position);
  if (previous.rotationMotionMode !== scene.params.rotationMotionMode) clock.rotationPhase = scene.params.rotationMotionMode === 'pingpong'
    ? rebasePingPongPosition(before.continuousRotation, (before.rotation + 180) / 360)
    : rebaseContinuousPosition(before.continuousRotation, wrap01(before.continuousRotation), wrap01(before.rotation / 360));
  for (const method of ['trace', 'radial']) {
    const directions = `${method}HeadDirections`, adjustments = `${method}HeadDirectionAdjustments`;
    if (patch[directions] && !patch[adjustments]) scene.params[adjustments] = scene.params[adjustments].map((offset, i) =>
      offset + (previous[directions][i] - scene.params[directions][i]) * before.continuousPosition);
  }
  clock.rotating = scene.params.autoRotate;
  rebuild();
}
function command(name, value) {
  rebase();
  if (name === 'play') clock.playing = !clock.playing;
  if (name === 'rotationPlay') { clock.rotating = !clock.rotating; scene.params.autoRotate = clock.rotating; }
  if (name === 'position') clock.phase = scene.params.motionMode === 'pingpong' ? rebasePingPongPosition(clock.phase, value) : rebaseContinuousPosition(clock.phase, wrap01(clock.phase), value);
  if (name === 'rotation') clock.rotationPhase = scene.params.rotationMotionMode === 'pingpong' ? rebasePingPongPosition(clock.rotationPhase, (value + 180) / 360) : rebaseContinuousPosition(clock.rotationPhase, wrap01(clock.rotationPhase), wrap01(value / 360));
  if (name === 'resetDemo') { remember(); applyScene({ version: 3, blobs: demoBlobs(), params: defaultParameters() }); announce('Demo restored.'); return; }
  syncAudio(); refresh(); save();
}
function applyScene(next) {
  const normalized = normalizeScene(next);
  if (!normalized || normalized.blobs.length !== next.blobs.length) throw new TypeError('Invalid Blobs scene');
  if (drag) cancelGesture();
  const before = rebase(), previous = scene.params;
  scene = normalized;
  if (previous.motionMode !== scene.params.motionMode) clock.phase = scene.params.motionMode === 'pingpong' ? rebasePingPongPosition(clock.phase, before.position) : rebaseContinuousPosition(clock.phase, wrap01(clock.phase), before.position);
  if (previous.rotationMotionMode !== scene.params.rotationMotionMode) clock.rotationPhase = scene.params.rotationMotionMode === 'pingpong' ? rebasePingPongPosition(clock.rotationPhase, (before.rotation + 180) / 360) : rebaseContinuousPosition(clock.rotationPhase, wrap01(clock.rotationPhase), wrap01(before.rotation / 360));
  clock.rotating = scene.params.autoRotate; draft = []; selectedPoint = 0;
  rebuild(); announce(`${scene.blobs.length} closed ${scene.blobs.length === 1 ? 'blob' : 'blobs'}`);
}
function refreshAudio() {
  $('audioButton').setAttribute('aria-pressed', String(armed));
  $('audioButton').classList.toggle('active', armed);
  $('audioState').textContent = starting ? 'starting' : armed ? 'on' : 'off';
}
function updateLevel() {
  const level = clamp(Number($('level').value), 0, 1);
  $('levelOut').textContent = `${Math.round(level * 100)}%`;
  if (master) master.gain.setTargetAtTime(armed ? level : 0, audioContext.currentTime, .02);
}
function closeAudio() {
  changeClockSource(false);
  node?.port.postMessage({ type: 'dispose' });
  if (node) { node.onprocessorerror = null; node.disconnect(); }
  master?.disconnect(); releaseOutput?.();
  if (audioContext) { audioContext.onstatechange = null; void audioContext.close().catch(() => {}); }
  audioContext = node = master = releaseOutput = null;
}
async function setAudio(next) {
  if (disposed) return;
  wanted = Boolean(next);
  if (!wanted) { armed = false; updateLevel(); refreshAudio(); return; }
  if (starting) return;
  starting = true; $('audioError').hidden = true; refreshAudio();
  try {
    const AudioContextClass = window.AudioContext ?? window.webkitAudioContext;
    if (!AudioContextClass) throw new Error('Web Audio is unavailable in this browser.');
    if (!audioContext) {
      audioContext = new AudioContextClass({ latencyHint: 'interactive' });
      audioContext.onstatechange = () => {
        if (disposed) return;
        changeClockSource(audioContext?.state === 'running');
        if (!starting && wanted && audioContext?.state !== 'running') {
          armed = false; wanted = false; updateLevel(); refreshAudio();
          announce('Audio interrupted. Tap Audio to resume.');
        }
      };
    }
    await resumeAudioContext(audioContext);
    if (disposed) return;
    changeClockSource(true);
    if (!node) {
      await withAudioTimeout(audioContext.audioWorklet.addModule(new URL('./processor.js', import.meta.url)));
      if (disposed) return;
      node = new AudioWorkletNode(audioContext, 'blobs', { numberOfInputs: 0, numberOfOutputs: 1, outputChannelCount: [2] });
      master = audioContext.createGain(); master.gain.value = 0;
      node.connect(master); releaseOutput = connectAudioOutput(audioContext, master);
      node.onprocessorerror = () => {
        armed = wanted = false; closeAudio(); refreshAudio();
        $('audioError').hidden = false; $('audioError').textContent = 'Sound stopped. Tap Audio to restart.';
      };
      syncAudio();
    }
    if (audioContext.state !== 'running') throw new Error('Audio was interrupted. Tap Audio to try again.');
    armed = wanted; updateLevel();
  } catch (error) {
    armed = wanted = false; closeAudio();
    if (!disposed) { $('audioError').hidden = false; $('audioError').textContent = `Audio could not start: ${error.message}`; }
  } finally { starting = false; if (!disposed) refreshAudio(); }
}

function finishPath() {
  const blob = { tool: tool === 'edit' ? 'line' : tool, points: cleanPoints(draft) };
  if (!buildPath(blob)) { announce('Add at least three distinct points to make a loop.'); return; }
  if (scene.blobs.length >= MAX_BLOBS) { announce('Six blobs maximum. Delete a blob to draw another.'); return; }
  remember(); scene.blobs.push(blob); selected = scene.blobs.length - 1; selectedPoint = 0; selectedCopy = 'identity';
  draft = []; drag = null; rebuild(); announce(`${scene.blobs.length} closed ${scene.blobs.length === 1 ? 'blob' : 'blobs'}`);
}
function cancelDraft() { draft = []; drag = null; refresh(); announce('Drawing cancelled.'); }
function chooseTool(next) {
  if (drag) cancelGesture();
  draft = []; tool = next; keyboardCursor = false; hover = null;
  for (const button of document.querySelectorAll('[data-tool]')) button.setAttribute('aria-pressed', String(button.dataset.tool === tool));
  $('drawingHelp').textContent = {
    pencil: 'Draw a stroke; release to connect its ends.',
    pen: 'Click points; drag for curves. Return to the first point to close.',
    line: 'Click connected corners. Return to the first point to close.',
    edit: 'Drag points or handles. Double-click a line to add a point. Delete removes the selected point.',
  }[tool];
  canvas.style.cursor = tool === 'edit' ? 'default' : 'crosshair';
  refresh();
}
function pointerPoint(event) {
  const rect = canvas.getBoundingClientRect();
  return { x: (event.clientX - rect.left - offsetX) / stageSize, y: (event.clientY - rect.top - offsetY) / stageSize, hx: 0, hy: 0 };
}
function editorPoint(point, path, rotation = liveState().rotation) {
  return rotateUnitPoint(reflectPoint(transformAnchor(point, path, 0), path.reflection), rotation);
}
function sourcePoint(point, path, rotation = liveState().rotation) {
  return inverseAnchor(unreflectPoint(rotateUnitPoint(point, -rotation), path.reflection), path, 0);
}
function selectedPath() { return paths.find(path => path.sourceIndex === selected && path.reflectionId === selectedCopy) ?? paths.find(path => path.sourceIndex === selected); }
function selectHit(hit) { selected = hit.blob; selectedPoint = hit.point; selectedCopy = hit.path.reflectionId; refresh(); }
function nearestPoint(point, radius = 10 / stageSize) {
  let hit = null, best = radius;
  const rotation = liveState().rotation;
  for (const path of paths) {
    const blob = scene.blobs[path.sourceIndex];
    blob.points.forEach((p, index) => {
      const gap = distance(editorPoint(p, path, rotation), point);
      if (gap < best) { best = gap; hit = { blob: path.sourceIndex, point: index, path, kind: 'anchor' }; }
    });
  }
  if (hit) return hit;
  const path = selectedPath(), p = scene.blobs[selected]?.points[selectedPoint];
  if (path && p && scene.blobs[selected].tool === 'pen') for (const kind of ['in', 'out']) {
    const handle = handles(p)[kind];
    if (Math.hypot(handle.x, handle.y) < .0001) continue;
    const gap = distance(editorPoint({ x: p.x + handle.x, y: p.y + handle.y }, path, rotation), point);
    if (gap < best) { best = gap; hit = { blob: selected, point: selectedPoint, path, kind }; }
  }
  return hit;
}
function nearestLine(point, radius = 10 / stageSize) {
  let hit = null, best = radius;
  const rotation = liveState().rotation;
  for (const path of paths) {
    const blob = scene.blobs[path.sourceIndex];
    if (!scene.params.curvature) {
      const found = nearestSegment(blob, point, { transform: p => editorPoint(p, path, rotation), maxDistance: best });
      if (found && found.distance < best) { best = found.distance; hit = { ...found, blob: path.sourceIndex, path }; }
    } else {
      // Locate authored segment parameters on the actual deformed outline.
      const outline = rotatePath(path, rotation).points;
      for (let i = 0; i < outline.length; i++) {
        const a = outline[i], b = outline[(i + 1) % outline.length], dx = b.x - a.x, dy = b.y - a.y;
        const t = clamp(((point.x * 2 - 1 - a.x) * dx + (point.y * 2 - 1 - a.y) * dy) / Math.max(1e-12, dx * dx + dy * dy), 0, 1);
        const gap = Math.hypot(a.x + dx * t - (point.x * 2 - 1), a.y + dy * t - (point.y * 2 - 1)) / 2;
        if (gap >= best) continue;
        const from = path.locations[i], to = path.locations[(i + 1) % path.locations.length];
        const travel = from.segment + from.t, end = (i + 1 === outline.length ? blob.points.length : to.segment + to.t);
        const at = travel + (end - travel) * t;
        best = gap; hit = { blob: path.sourceIndex, path, segment: Math.floor(at) % blob.points.length, t: at % 1, distance: gap };
      }
    }
  }
  return hit;
}
function commitBlob(next, message, point = selectedPoint) {
  if (!next || !buildPath(next) || cleanPoints(next.points).length !== next.points.length) { announce('Keep at least three distinct points in the loop.'); return false; }
  remember(); scene.blobs[selected] = next; selectedPoint = point; rebuild(); announce(message); return true;
}
function addPoint(hit) {
  if (!hit) return;
  selected = hit.blob; selectedCopy = hit.path.reflectionId;
  const blob = scene.blobs[selected];
  if (blob.points.length >= MAX_POINTS) { announce('Point limit reached. Delete a point first.'); return; }
  commitBlob(insertPoint(blob, hit.segment, hit.t), 'Point added. Drag it to reshape the loop.', hit.segment + 1);
}
function deleteSelectedPoint() {
  if (tool !== 'edit' || !scene.blobs.length) return;
  commitBlob(removePoint(scene.blobs[selected], selectedPoint), 'Point deleted. The loop stays connected.', Math.max(0, selectedPoint - 1));
}
function stepHistory(forward = false) {
  if (drag) cancelGesture();
  if (draft.length && !forward) { draft = []; refresh(); announce('Draft removed.'); return; }
  const source = forward ? redo : undo, target = forward ? undo : redo;
  if (!source.length) return;
  target.push(snapshot()); applyScene(JSON.parse(source.pop())); announce(forward ? 'Change redone.' : 'Change undone.');
}
on(canvas, 'pointerdown', event => {
  if (event.button !== 0 || drag || (tool === 'edit' && event.detail > 1)) return;
  event.preventDefault(); canvas.focus({ preventScroll: true }); keyboardCursor = false;
  const p = pointerPoint(event); cursor = p;
  if (tool === 'edit') {
    const hit = nearestPoint(p, (event.pointerType === 'touch' ? 20 : 10) / stageSize);
    if (!hit) {
      const line = nearestLine(p); if (line) { selected = line.blob; selectedCopy = line.path.reflectionId; selectedPoint = line.segment; refresh(); }
      else announce('Drag a point, or double-click a line to add one.');
      return;
    }
    selectHit(hit);
    const local = sourcePoint(p, hit.path), anchor = scene.blobs[selected].points[selectedPoint];
    drag = { id: event.pointerId, before: snapshot(), moved: false, kind: hit.kind, start: p, offset: { x: anchor.x - local.x, y: anchor.y - local.y }, original: { ...anchor } };
    canvas.style.cursor = 'grabbing';
  } else {
    if (scene.blobs.length >= MAX_BLOBS) { announce('Six blobs maximum. Delete a blob to draw another.'); return; }
    Object.assign(p, rotateUnitPoint(p, -liveState().rotation));
    p.x = clamp(p.x, .02, .98); p.y = clamp(p.y, .02, .98);
    if (draft.length >= 3 && distance(p, draft[0]) < 18 / stageSize && tool !== 'pencil') { finishPath(); return; }
    if (tool === 'pencil') draft = [];
    if (draft.length >= MAX_POINTS && tool !== 'pencil') { announce('Point limit reached. Close this loop.'); return; }
    const previous = draft.length;
    draft.push(p); drag = { id: event.pointerId, previous };
    refresh();
  }
  canvas.setPointerCapture(event.pointerId);
});
on(canvas, 'pointermove', event => {
  cursor = pointerPoint(event);
  if (!drag) {
    if (tool === 'edit') { hover = nearestPoint(cursor); canvas.style.cursor = hover ? 'grab' : 'default'; }
    return;
  }
  if (drag.id !== event.pointerId) return;
  if (tool === 'edit') {
    if (!drag.moved && distance(cursor, drag.start) * stageSize < 2) return;
    const path = selectedPath(), p = scene.blobs[selected].points[selectedPoint], local = sourcePoint(cursor, path);
    const previous = { ...p };
    if (drag.kind === 'anchor') { p.x = clamp(local.x + drag.offset.x, .02, .98); p.y = clamp(local.y + drag.offset.y, .02, .98); }
    else {
      const hx = clamp(local.x - p.x, -1, 1), hy = clamp(local.y - p.y, -1, 1), original = handles(drag.original);
      p.inHx ??= -p.hx; p.inHy ??= -p.hy;
      if (drag.kind === 'out') { p.hx = hx; p.hy = hy; } else { p.inHx = hx; p.inHy = hy; }
      if (!event.altKey) {
        const opposite = original[drag.kind === 'out' ? 'in' : 'out'], scale = Math.hypot(opposite.x, opposite.y) / Math.max(1e-9, Math.hypot(hx, hy));
        if (drag.kind === 'out') { p.inHx = -hx * scale; p.inHy = -hy * scale; } else { p.hx = -hx * scale; p.hy = -hy * scale; }
      }
    }
    const next = buildPerformancePath(scene.blobs[selected], scene.params);
    if (!next || cleanPoints(scene.blobs[selected].points).length !== scene.blobs[selected].points.length) { Object.assign(p, previous); return; }
    drag.moved = true; basePaths[selected] = next; paths = expandPaths(basePaths, scene.params.reflectionAxes);
    if (performance.now() - lastEditAudio > 24) { syncAudio(); lastEditAudio = performance.now(); }
  } else if (tool === 'pencil') {
    for (const sample of event.getCoalescedEvents?.().length ? event.getCoalescedEvents() : [event]) {
      const p = rotateUnitPoint(pointerPoint(sample), -liveState().rotation); p.x = clamp(p.x, .02, .98); p.y = clamp(p.y, .02, .98);
      if (distance(p, draft.at(-1)) > .004) {
        if (draft.length >= 2048) draft.splice(1, draft.length - 2, ...draft.slice(1, -1).filter((_, i) => i % 2 === 0));
        draft.push(p);
      }
    }
  } else if (tool === 'pen') {
    const p = draft.at(-1), local = rotateUnitPoint(cursor, -liveState().rotation); p.hx = clamp(local.x - p.x, -.3, .3); p.hy = clamp(local.y - p.y, -.3, .3);
  }
});
on(canvas, 'pointerup', event => {
  if (!drag || drag.id !== event.pointerId) return;
  const finished = drag; drag = null;
  if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
  if (tool === 'edit') { if (finished.moved) remember(finished.before); rebuild(); canvas.style.cursor = 'grab'; }
  else if (tool === 'pencil') { finishPath(); if (draft.length) { draft = []; refresh(); } }
  else refresh();
});
on(canvas, 'dblclick', event => {
  if (tool !== 'edit') return;
  event.preventDefault();
  const point = pointerPoint(event);
  if (nearestPoint(point, 7 / stageSize)?.kind === 'anchor') return;
  addPoint(nearestLine(point, 14 / stageSize));
});
function cancelGesture() {
  if (!drag) return;
  const cancelled = drag; drag = null;
  if (tool === 'edit') { scene = normalizeScene(JSON.parse(cancelled.before)); rebuild(); }
  else { draft = tool === 'pencil' ? [] : draft.slice(0, cancelled.previous); refresh(); }
  if (canvas.hasPointerCapture(cancelled.id)) canvas.releasePointerCapture(cancelled.id);
}
on(canvas, 'pointercancel', cancelGesture);
on(canvas, 'lostpointercapture', cancelGesture);
on(canvas, 'pointerleave', () => { hover = null; });
on(canvas, 'keydown', event => {
  if (event.defaultPrevented) return;
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z') { event.preventDefault(); stepHistory(event.shiftKey); return; }
  if (event.ctrlKey || event.metaKey || event.altKey) return;
  const blob = scene.blobs[selected];
  if (tool === 'edit' && ['Delete', 'Backspace'].includes(event.key)) { event.preventDefault(); deleteSelectedPoint(); return; }
  if (tool === 'edit' && event.key === 'Enter' && blob) { event.preventDefault(); addPoint({ blob: selected, path: selectedPath(), segment: selectedPoint, t: .5 }); return; }
  if (tool === 'edit' && event.key === 'Tab' && blob) {
    const next = selectedPoint + (event.shiftKey ? -1 : 1);
    if (next >= 0 && next < blob.points.length) { event.preventDefault(); selectedPoint = next; refresh(); announce(`Blob ${selected + 1}, point ${next + 1}`); }
    return;
  }
  if (event.key.startsWith('Arrow')) {
    event.preventDefault(); keyboardCursor = true;
    const path = selectedPath(), point = tool === 'edit' && blob ? editorPoint(blob.points[selectedPoint], path) : { ...cursor };
    const step = event.shiftKey ? .04 : .01;
    point.x += event.key === 'ArrowRight' ? step : event.key === 'ArrowLeft' ? -step : 0;
    point.y += event.key === 'ArrowDown' ? step : event.key === 'ArrowUp' ? -step : 0;
    if (tool === 'edit' && blob) {
      const next = { ...blob, points: blob.points.map(p => ({ ...p })) }, local = sourcePoint(point, path);
      Object.assign(next.points[selectedPoint], { x: clamp(local.x, .02, .98), y: clamp(local.y, .02, .98) });
      commitBlob(next, `Point ${selectedPoint + 1} moved.`);
    } else cursor = { ...cursor, x: clamp(point.x, .02, .98), y: clamp(point.y, .02, .98) };
  } else if (event.key === 'Enter' && tool !== 'edit') {
    event.preventDefault();
    if (scene.blobs.length >= MAX_BLOBS || draft.length >= MAX_POINTS) return;
    draft.push({ ...rotateUnitPoint(cursor, -liveState().rotation), hx: tool === 'pen' ? .065 : 0, hy: 0 }); refresh();
  } else if (event.key.toLowerCase() === 'c' && draft.length) { event.preventDefault(); finishPath(); }
  else if (event.key === 'Escape') { event.preventDefault(); cancelGesture(); if (draft.length) cancelDraft(); }
});
on(window, 'keydown', event => {
  if (event.defaultPrevented || !(event.ctrlKey || event.metaKey) || event.key.toLowerCase() !== 'z') return;
  if (event.target.closest?.('input, textarea, select, [contenteditable="true"]')) return;
  event.preventDefault(); stepHistory(event.shiftKey);
});

on($('audioButton'), 'click', () => { void setAudio(!wanted); });
on($('level'), 'input', updateLevel);
for (const button of document.querySelectorAll('[data-tool]')) on(button, 'click', () => chooseTool(button.dataset.tool));
on($('closePath'), 'click', finishPath);
on($('cancelPath'), 'click', cancelDraft);
on($('selectedBlob'), 'change', () => { selected = Number($('selectedBlob').value); selectedPoint = 0; selectedCopy = 'identity'; chooseTool('edit'); });
on($('undo'), 'click', () => stepHistory());
on($('redo'), 'click', () => stepHistory(true));
on($('deletePoint'), 'click', deleteSelectedPoint);
on($('insertPoint'), 'click', () => { if (scene.blobs.length) addPoint({ blob: selected, path: selectedPath(), segment: selectedPoint, t: .5 }); });
on($('deleteBlob'), 'click', () => { if (!scene.blobs.length) return; remember(); scene.blobs.splice(selected, 1); rebuild(); announce('Blob deleted.'); });
on($('clearAll'), 'click', () => { remember(); scene.blobs = []; draft = []; rebuild(); chooseTool('pencil'); announce('Canvas cleared. Draw a new blob.'); });
for (const id of ['cornerPoint', 'smoothPoint']) on($(id), 'click', () => {
  const blob = scene.blobs[selected]; if (!blob || tool !== 'edit') return;
  commitBlob(smoothPoint(blob, selectedPoint, id === 'smoothPoint'), id === 'smoothPoint' ? 'Selected point smoothed.' : 'Selected point is a corner.');
});
for (const button of document.querySelectorAll('[data-reflection-axis]')) on(button, 'click', () => {
  if (drag) cancelGesture();
  const axis = button.dataset.reflectionAxis, axes = scene.params.reflectionAxes;
  remember(); changeParameters({ reflectionAxes: axes.includes(axis) ? axes.filter(value => value !== axis) : [...axes, axis] });
  announce('Reflections updated. Every copy stays linked.');
});
on($('clearSymmetry'), 'click', () => { remember(); changeParameters({ reflectionAxes: [] }); });

function resize() {
  const sizing = canvasSizing(canvas.getBoundingClientRect(), devicePixelRatio);
  width = sizing.cssWidth; height = sizing.cssHeight; ratio = sizing.pixelRatio;
  canvas.width = sizing.width; canvas.height = sizing.height;
  stageSize = Math.max(1, Math.min(width - 32, height - 92));
  offsetX = (width - stageSize) / 2; offsetY = 58 + (height - 92 - stageSize) / 2;
}
function drawDot(p, size, fill, stroke) {
  context.beginPath(); context.arc(offsetX + p.x * stageSize, offsetY + p.y * stageSize, size, 0, Math.PI * 2);
  context.fillStyle = fill; context.fill();
  if (stroke) { context.strokeStyle = stroke; context.lineWidth = 1.5; context.stroke(); }
}
function trace(points, closed) {
  context.beginPath();
  points.forEach((p, i) => context[i ? 'lineTo' : 'moveTo'](offsetX + p.x * stageSize, offsetY + p.y * stageSize));
  if (closed) context.closePath();
}
function draw(timestamp = performance.now()) {
  if (disposed) return;
  frame = requestAnimationFrame(draw);
  // Leave CPU time for sound when many intersections make a drawing expensive.
  const interval = document.hidden ? 250 : Math.max(drag ? 16 : paths.length * scene.params.heads > 24 ? 50 : 16, drawCost * 4);
  if (timestamp - lastDrawAt < interval - 1) return;
  lastDrawAt = timestamp;
  const started = performance.now();
  context.setTransform(ratio, 0, 0, ratio, 0, 0);
  context.clearRect(0, 0, width, height);
  context.strokeStyle = '#152229'; context.lineWidth = 1;
  for (let y = .1; y < 1; y += .1) {
    context.beginPath(); context.moveTo(offsetX, offsetY + y * stageSize); context.lineTo(offsetX + stageSize, offsetY + y * stageSize); context.stroke();
  }
  const state = liveState(), reader = createShapeReaderModel(state), sound = createShapeSoundModel(state);
  const toScreen = p => ({ x: (p.x + 1) / 2, y: (p.y + 1) / 2 });
  let firstContact = null, firstPath = null;
  if (scene.params.reflectionAxes.length) {
    const axes = { horizontal: [{ x: .03, y: .5 }, { x: .97, y: .5 }], vertical: [{ x: .5, y: .03 }, { x: .5, y: .97 }], diagonal: [{ x: .03, y: .97 }, { x: .97, y: .03 }], antiDiagonal: [{ x: .03, y: .03 }, { x: .97, y: .97 }] };
    context.setLineDash([5, 7]); context.lineWidth = 1; context.strokeStyle = '#b59aff80';
    for (const axis of scene.params.reflectionAxes) { trace(axes[axis].map(p => rotateUnitPoint(p, state.rotation)), false); context.stroke(); }
    context.setLineDash([]); drawDot({ x: .5, y: .5 }, 3, '#b59aff');
  }
  paths.forEach(basePath => {
    const index = basePath.sourceIndex;
    const path = rotatePath(basePath, state.rotation), color = COLORS[index], points = path.points.map(toScreen);
    trace(points, true); context.fillStyle = `${color}10`; context.fill();
    context.strokeStyle = color; context.lineWidth = index === selected ? 2.5 : 1.5; context.stroke();
    for (const vertex of path.vertexIndices) drawDot(toScreen(path.points[vertex]), 2.5, '#ffb86b');
    if (tool === 'edit') scene.blobs[index].points.forEach((p, i) => {
      const active = index === selected && i === selectedPoint, handle = hover?.blob === index && hover?.point === i;
      drawDot(editorPoint(p, basePath, state.rotation), active ? 6 : handle ? 5 : 3.5, active ? color : '#10171d', color);
    });
    if (tool === 'edit' && index === selected && basePath.reflectionId === (selectedPath()?.reflectionId) && scene.blobs[index].tool === 'pen') {
      const p = scene.blobs[index].points[selectedPoint], anchor = editorPoint(p, basePath, state.rotation);
      for (const handle of Object.values(handles(p))) {
        if (Math.hypot(handle.x, handle.y) < .0001) continue;
        const point = editorPoint({ x: p.x + handle.x, y: p.y + handle.y }, basePath, state.rotation);
        trace([anchor, point], false); context.strokeStyle = color; context.lineWidth = 1; context.stroke();
        drawDot(point, 4, '#10171d', '#f1fff9');
      }
    }
    const reading = reader.collectContacts(path);
    if (!firstContact && reading.contacts.length) { firstContact = reading.contacts[0]; firstPath = path; }
    for (const head of reading.heads) {
      const guide = state.playMethod === 'scan'
        ? head.axis === 'horizontal' ? [{ x: path.bounds.minX, y: head.coordinate }, { x: path.bounds.maxX, y: head.coordinate }] : [{ x: head.coordinate, y: path.bounds.minY }, { x: head.coordinate, y: path.bounds.maxY }]
        : state.playMethod === 'radial' ? [{ x: 0, y: 0 }, { x: Math.cos(head.angle), y: Math.sin(head.angle) }] : null;
      if (guide) { trace(guide.map(toScreen), false); context.strokeStyle = `${color}60`; context.lineWidth = 1; context.stroke(); }
    }
    const stride = Math.max(1, Math.ceil(reading.contacts.length / Math.max(12, 96 / paths.length)));
    for (let i = 0; i < reading.contacts.length; i += stride) { const contact = reading.contacts[i], p = toScreen(contact); drawDot(p, 10, `${color}20`); drawDot(p, 4, contact.headIndex === 0 ? '#f1fff9' : color, '#080c10'); }
  });
  const mapping = firstContact ? sound.mappingForContact(firstContact, firstPath) : null;
  if (timestamp - lastReadoutAt >= 100) {
    lastReadoutAt = timestamp;
    controls?.frame(state, { phase: state.position, blobs: scene.blobs.length, readout: `${scene.blobs.length} ${scene.blobs.length === 1 ? 'BLOB' : 'BLOBS'} · ${armed ? 'AUDIO ON' : 'AUDIO OFF'}`, contacts: firstContact ? state.heads : 0, x: firstContact?.x, y: firstContact?.y, center: firstContact ? Math.hypot(firstContact.x, firstContact.y) : 0, turn: (firstContact?.cornerTurn ?? 0) * 180, cornerDistance: firstContact?.cornerDistance01 ?? 0, incidence: mapping?.incidence ?? 0, tangent: (firstContact?.tangentAngle ?? 0) * 180 / Math.PI, pitch: mapping?.pitch ?? 0, frequency: mapping ? sound.synthFrequencyForMapping(mapping) : 0, pan: mapping?.pan ?? 0, gain: firstContact ? sound.amplitudeGainForContact(firstContact, firstPath) : 0 });
  }
  if (draft.length) {
    const color = COLORS[scene.blobs.length % COLORS.length];
    for (const reflection of reflectionTransforms(scene.params.reflectionAxes)) {
      const project = p => rotateUnitPoint(reflectPoint(p, reflection), state.rotation);
      const first = project(draft[0]);
      context.strokeStyle = color; context.lineWidth = 2; context.beginPath();
      context.moveTo(offsetX + first.x * stageSize, offsetY + first.y * stageSize);
      for (let i = 1; i < draft.length; i++) {
        const a = draft[i - 1], b = draft[i], end = project(b);
        if (tool === 'pen') {
          const out = project({ x: a.x + a.hx, y: a.y + a.hy }), incoming = handles(b).in, into = project({ x: b.x + incoming.x, y: b.y + incoming.y });
          context.bezierCurveTo(offsetX + out.x * stageSize, offsetY + out.y * stageSize, offsetX + into.x * stageSize, offsetY + into.y * stageSize, offsetX + end.x * stageSize, offsetY + end.y * stageSize);
        } else context.lineTo(offsetX + end.x * stageSize, offsetY + end.y * stageSize);
      }
      context.stroke(); context.setLineDash([4, 5]);
      trace([project(draft.at(-1)), first], false); context.globalAlpha = .5; context.stroke(); context.globalAlpha = 1; context.setLineDash([]);
      drawDot(first, 7, '#10171d', color);
      if (tool !== 'pencil') draft.slice(1).forEach(p => drawDot(project(p), 3, color));
      if (tool === 'pen') for (const p of draft) {
        const incoming = handles(p).in;
        trace([project({ x: p.x + incoming.x, y: p.y + incoming.y }), project({ x: p.x + p.hx, y: p.y + p.hy })], false);
        context.strokeStyle = `${color}66`; context.lineWidth = 1; context.stroke();
        drawDot(project({ x: p.x + p.hx, y: p.y + p.hy }), 2.5, color);
      }
    }
  }
  if (keyboardCursor && tool !== 'edit' && document.activeElement === canvas) {
    drawDot(cursor, 6, '#ffffff20', '#ffffff');
  }
  drawCost = drawCost * .6 + (performance.now() - started) * .4;
}
const observer = new ResizeObserver(resize); observer.observe(canvas);
on(window, 'pagehide', () => {
  if (disposed) return;
  save(); disposed = true; cancelAnimationFrame(frame); observer.disconnect(); closeAudio(); controls?.destroy(); presetController?.destroy(); events.abort();
});
// A bfcache return starts a fresh, silent session with the saved drawing.
window.addEventListener('pageshow', event => { if (event.persisted && disposed) location.reload(); });
controls = mountBlobsControls({ getState: liveState, change: changeParameters, command, signal: events.signal });
rebuild();
presetController = registerHeaderPresets({ id: 'blobs', presets: BLOB_PRESETS, capture: () => JSON.parse(snapshot()), apply: applyScene, randomize: randomizeBlobs });
resize(); chooseTool('edit'); refreshAudio(); draw();
announce(`${scene.blobs.length} closed ${scene.blobs.length === 1 ? 'blob' : 'blobs'}`);

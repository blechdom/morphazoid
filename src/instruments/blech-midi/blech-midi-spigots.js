import { blackMidiKeyLayout, blackMidiTimeGeometry } from './blech-midi-black-renderer.js';
import { midiStampPitchBounds } from '../midi-mixer/midi-mixer-score-transform.js';
import { mountBlechStampPicker } from './blech-midi-stamp-picker.js';

const clamp = (value, min, max, fallback = min) => Math.max(min, Math.min(max, Number.isFinite(Number(value)) ? Number(value) : fallback));
const quarter = value => Math.round(value * 4) / 4;
const degrees = value => ((value % 360) + 360) % 360;
const MODES = ['select', 'draw', 'erase', 'stamp'];
const TOOL_ICONS = {
  draw: '<path d="m4 16-1 5 5-1L20 8l-4-4L4 16Z"/><path d="m13 7 4 4M4 16l4 4M16 4l2-2 4 4-2 2"/>',
  erase: '<path d="m4 13 9-9a2 2 0 0 1 3 0l5 5a2 2 0 0 1 0 3l-9 9H7l-4-4a3 3 0 0 1 1-4Z"/><path d="m8 9 8 8M12 21h10"/>',
  stamp: '<path d="M9 14V9c0-2-2-3-2-5a5 5 0 0 1 10 0c0 2-2 3-2 5v5M6 14h12l3 4H3l3-4ZM4 21h16"/>',
};
const toolIcon = mode => `<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">${TOOL_ICONS[mode]}</svg>`;

/** The future plane shares the renderer's pitch positions and audio-time scale. */
export function spigotGeometry(width, height, tempo = 120, view = {}) {
  const time = blackMidiTimeGeometry(view, height);
  return { width, height, present: time.keyboardTop * height, pixelsPerBeat: time.velocity * height * 60 / clamp(tempo, 1, 4800, 120), layout: blackMidiKeyLayout(view.alignment) };
}
export function spigotPoint(x, y, geometry) {
  const position = clamp(x / Math.max(1, geometry.width), 0, 1);
  let pitch = 0, distance = Infinity;
  geometry.layout.forEach((key, index) => {
    const delta = Math.abs(key.x + key.width / 2 - position);
    if (delta < distance) { distance = delta; pitch = index; }
  });
  return { pitch, delayBeats: quarter(clamp((geometry.present - y) / Math.max(.001, geometry.pixelsPerBeat), 0, 64)) };
}
export function spigotPlacement(score, settings, point) {
  const pitch = midiStampPitchBounds(score?.analysis?.notes ?? []);
  const transpose = Math.round(clamp(point.pitch - (pitch.low + pitch.high) / 2, -pitch.low, 127 - pitch.high, 0));
  return { ...settings, transpose, delayBeats: point.delayBeats };
}
export function spigotDimensions(source) {
  const score = source.score, pitch = midiStampPitchBounds(score?.analysis?.notes ?? []), settings = source.settings ?? source;
  // Rotating a chord into one column must retain its editable envelope. These
  // score bounds already include routing/transposition, just like the notes.
  const low = Number.isFinite(score?.pitchLow) ? score.pitchLow : pitch.low;
  const high = Number.isFinite(score?.pitchHigh) ? score.pitchHigh : pitch.high;
  return { ...pitch, low, high, width: high - low + 1, heightBeats: score?.analysis?.durationBeats ?? settings.heightBeats ?? 1, delayBeats: settings.delayBeats ?? 2 };
}

/** Persistent source handles; the owner owns all audio clocks, notes and source state. */
export function mountBlechSpigots(viewport, {
  controlsHost, getLayers = () => [], getPreparedScore = () => null, getTempo = () => 120, getView = () => ({}),
  getStampEntries = () => [], getSelectedStampId = () => null, onSelectStamp,
  onCreate, onEdit, onToggleLoop, onTogglePlay, onRemove, onBrushStart, onBrushMove, onBrushEnd, onLatch, onModeChange, onSelectionChange,
} = {}) {
  const events = new AbortController(), listen = (node, type, callback) => node.addEventListener(type, callback, { signal: events.signal });
  const ownedHost = !controlsHost;
  if (!controlsHost) { controlsHost = document.createElement('div'); viewport.before(controlsHost); }
  controlsHost.classList.add('blech-spigot-controls');
  controlsHost.innerHTML = `<div class="blech-spigot-mode" role="group" aria-label="Canvas tools"><button type="button" data-spigot-mode="draw" aria-label="Pencil" title="Pencil" aria-pressed="false">${toolIcon('draw')}</button><button type="button" data-spigot-mode="erase" aria-label="Eraser" title="Eraser" aria-pressed="false">${toolIcon('erase')}</button><div data-spigot-stamp-picker></div><output data-spigot-status role="status">Choose a tool, or select a layer to reshape it.</output></div>`;
  const overlay = document.createElement('div'); overlay.className = 'blech-spigot-overlay';
  overlay.innerHTML = `<canvas class="blech-spigot-preview" aria-label="Selected MIDI source pattern"></canvas><div class="blech-spigot-paint" tabindex="-1" role="group" aria-label="MIDI flow canvas. Arrow keys position; hold Enter to draw, erase or stamp; Escape returns to layer editing." data-space-key-owner></div><div class="blech-spigot-sources"></div><div class="blech-spigot-selection" hidden><button type="button" class="blech-spigot-move" aria-label="Move source; arrows change pitch and delay" data-space-key-owner></button>${['left','right','top','bottom','top-left','top-right','bottom-left','bottom-right'].map(edge => `<button type="button" class="blech-spigot-grip" data-spigot-resize="${edge}" aria-label="Resize source ${edge.replace('-', ' ')}; arrow keys adjust" data-space-key-owner></button>`).join('')}<button type="button" class="blech-spigot-rotate" aria-label="Rotate source; left and right arrows change angle" data-space-key-owner>↻</button><div class="blech-spigot-valves"><button type="button" data-spigot-play aria-label="Pause source">Ⅱ</button><button type="button" data-spigot-loop aria-label="Loop source" aria-pressed="false">↻</button><button type="button" data-spigot-remove aria-label="Remove source">×</button><button type="button" data-spigot-deselect aria-label="Deselect source">✓</button></div></div>`;
  viewport.append(overlay);
  const $ = selector => overlay.querySelector(selector), c$ = selector => controlsHost.querySelector(selector);
  const canvas = $('canvas'), context = canvas.getContext('2d'), surface = $('.blech-spigot-paint'), selection = $('.blech-spigot-selection');
  $('.blech-spigot-sources').remove();
  const label = document.createElement('div'); label.className = 'blech-spigot-label'; selection.append(label);
  const move = $('.blech-spigot-move');
  let mode = 'select', selectedId = null, disposed = false, drag = null, brush = null, pulse = null, cursor = { pitch: 64, delayBeats: 2 };
  let pendingEdit = null, editTimer = null, stampTicket = 0, stampBusy = false, stampMenu = null, recentDrawGestures = [];
  const geometry = () => { const rect = viewport.getBoundingClientRect(); return spigotGeometry(rect.width, rect.height, getTempo(), getView()); };
  const sources = () => getLayers() ?? [];
  const selected = () => sources().find(source => source.id === selectedId);
  const status = text => { c$('[data-spigot-status]').value = text; };
  const act = callback => { try { return callback?.(); } catch (error) { status(error.message); return null; } };
  function setSelection(id) {
    cancelEdit(); drag = null; selection.dataset.dragging = 'false';
    selectedId = id; onSelectionChange?.(id); render();
  }
  function setMode(next) {
    if (!MODES.includes(next)) return;
    endBrush(true); cancelEdit(); drag = null; selection.dataset.dragging = 'false'; mode = next;
    stampTicket++; stampBusy = false; recentDrawGestures = []; stampMenu?.close(); decorateStampPicker();
    onModeChange?.(mode); render();
    status(mode === 'select' ? 'Select a layer to move, resize or rotate it.' : mode === 'stamp' ? 'Tap to place this stamp. Hold for a longer phrase.' : mode === 'erase' ? 'Drag across notes in the selected layer to erase them.' : 'Draw a looping phrase. Hold for slower repeats; double-click to sustain.');
  }
  function decorateStampPicker() {
    if (!stampMenu) return;
    const summary = stampMenu.element.querySelector('summary');
    summary.dataset.spigotMode = 'stamp';
    summary.setAttribute('aria-pressed', String(mode === 'stamp'));
    summary.setAttribute('aria-busy', String(stampBusy));
    const current = stampMenu.element.querySelector('.instrument-picker-current');
    current.innerHTML = toolIcon('stamp');
  }
  function refreshStamps() {
    if (disposed || !stampMenu) return;
    act(() => {
      stampMenu.update(getStampEntries());
      const id = getSelectedStampId(); if (id != null) stampMenu.select(id);
      decorateStampPicker();
    });
  }
  async function chooseStamp(id, entry) {
    const ticket = ++stampTicket; stampBusy = true; decorateStampPicker();
    status(`Preparing ${entry.title ?? entry.label ?? id}…`);
    try {
      const result = await onSelectStamp?.(id, entry);
      if (disposed || ticket !== stampTicket) return;
      if (result === false) { stampBusy = false; refreshStamps(); status('Stamp was not prepared. Choose another stamp.'); return; }
      setMode('stamp');
      decorateStampPicker();
      surface.focus({ preventScroll: true });
    } catch (error) {
      if (!disposed && ticket === stampTicket) { stampBusy = false; refreshStamps(); status(error.message || 'Could not prepare this stamp.'); }
    }
  }
  stampMenu = mountBlechStampPicker(c$('[data-spigot-stamp-picker]'), {
    entries: [], onSelect: chooseStamp, label: 'Stamp', selectedId: getSelectedStampId(),
    placeholder: 'Find a shape or MIDI stamp', filterLabel: 'Filter canvas stamps', listLabel: 'Canvas stamps',
  });
  stampMenu.element.classList.add('blech-spigot-stamp-picker');
  stampMenu.element.querySelector('.instrument-picker-panel').classList.add('blech-spigot-stamp-grid');
  refreshStamps();
  listen(stampMenu.element.querySelector('summary'), 'click', () => { if (!stampMenu.element.open) refreshStamps(); });
  function edit(patch) {
    if (!selectedId) return;
    const settings = selected()?.settings;
    if (settings && Object.entries(patch).every(([key, value]) => settings[key] === value)) return;
    act(() => onEdit?.(selectedId, patch)); render();
  }
  function cancelEdit() { clearTimeout(editTimer); editTimer = null; pendingEdit = null; }
  function flushEdit() {
    const next = pendingEdit; cancelEdit();
    if (next && next.id === selectedId) edit(next.patch);
  }
  function queueEdit(patch) {
    pendingEdit = { id: selectedId, patch };
    // Dense artwork is parsed once per update, never once per pointer sample.
    if (editTimer === null) editTimer = setTimeout(flushEdit, 80);
  }
  function render() {
    if (disposed) return;
    const g = geometry(); if (!g.width || !g.height) return;
    const coarse = globalThis.matchMedia?.('(pointer: coarse)').matches, targetSize = coarse ? 48 : 28, valveHeight = coarse ? 48 : 30, valveWidth = coarse ? 201 : 145;
    overlay.style.height = `${Math.max(0, g.present - 2)}px`; canvas.style.height = `${g.height}px`;
    overlay.dataset.mode = mode; surface.style.height = `${Math.max(0, g.present - 2)}px`; surface.tabIndex = mode === 'select' ? -1 : 0;
    for (const button of controlsHost.querySelectorAll('[data-spigot-mode]')) button.setAttribute('aria-pressed', String(button.dataset.spigotMode === mode));
    c$('[data-spigot-mode="erase"]').disabled = !selected();
    for (const control of selection.querySelectorAll('.blech-spigot-move, .blech-spigot-grip, .blech-spigot-rotate')) control.tabIndex = mode === 'erase' ? -1 : 0;
    const current = sources(), ids = new Set(current.map(source => source.id));
    if (selectedId && !ids.has(selectedId)) { selectedId = null; onSelectionChange?.(null); }
    const dpr = Math.min(devicePixelRatio || 1, 2); canvas.width = Math.round(g.width * dpr); canvas.height = Math.round(g.height * dpr); context.setTransform(dpr, 0, 0, dpr, 0, 0);
    const source = selected(); selection.hidden = !source;
    if (!source) return;
    selection.dataset.spigotId = source.id;
    const settings = source.settings ?? source, d = spigotDimensions(source);
    const state = source.paused ? 'Paused' : source.playing ? settings.loop ? 'Looping' : 'Playing' : 'Stopped';
    label.textContent = `${source.name || 'Layer'} · ${state}`;
    move.setAttribute('aria-label', `Move ${source.name || 'layer'}; arrows change pitch and delay`);
    const low = g.layout[Math.round(clamp(d.low, 0, 127))], high = g.layout[Math.round(clamp(d.high, 0, 127))];
    const left = clamp(low.x * g.width, 2, Math.max(2, g.width - 24)), right = clamp((high.x + high.width) * g.width, left + 24, g.width - 2);
    const bottom = clamp(g.present - d.delayBeats * g.pixelsPerBeat, 28, g.present - 2), top = clamp(g.present - (d.delayBeats + d.heightBeats) * g.pixelsPerBeat, 2, bottom - 24);
    Object.assign($('.blech-spigot-move').style, { left: `${left}px`, top: `${top}px`, width: `${right - left}px`, height: `${bottom - top}px` });
    Object.assign(label.style, { left: `${left + 6}px`, top: `${top + 5}px`, maxWidth: `${Math.max(40, right - left - 12)}px` });
    for (const grip of overlay.querySelectorAll('[data-spigot-resize]')) {
      const edge = grip.dataset.spigotResize;
      grip.style.left = `${edge.includes('left') ? left : edge.includes('right') ? right : (left + right) / 2}px`;
      grip.style.top = `${edge.includes('top') ? top : edge.includes('bottom') ? bottom : (top + bottom) / 2}px`;
    }
    Object.assign($('.blech-spigot-rotate').style, { left: `${clamp((left + right) / 2, targetSize / 2, g.width - targetSize / 2)}px`, top: `${clamp(top - 22, targetSize / 2, Math.max(targetSize / 2, g.present - targetSize / 2 - 2))}px` });
    Object.assign($('.blech-spigot-valves').style, { left: `${clamp(left, 0, Math.max(0, g.width - valveWidth))}px`, top: `${clamp(bottom + 6, 0, Math.max(0, g.present - valveHeight - 2))}px` });
    const play = $('[data-spigot-play]'); play.textContent = source.paused || !source.playing ? '▶' : 'Ⅱ'; play.setAttribute('aria-label', source.paused || !source.playing ? 'Play source' : 'Pause source');
    $('[data-spigot-loop]').setAttribute('aria-pressed', String(Boolean(settings.loop)));
    const notes = source.score?.analysis?.notes ?? [], stride = Math.max(1, Math.ceil(notes.length / 4096)); context.fillStyle = '#ff8752'; context.globalAlpha = .55;
    for (let i = 0; i < notes.length; i += stride) {
      const note = notes[i], key = g.layout[note.note]; if (!key) continue;
      const y = g.present - (d.delayBeats + note.beat + note.duration) * g.pixelsPerBeat, end = g.present - (d.delayBeats + note.beat) * g.pixelsPerBeat;
      if (end < 0 || y > g.present) continue;
      context.fillRect(key.x * g.width, Math.max(0, y), Math.max(1, key.width * g.width), Math.max(1, Math.min(g.present, end) - Math.max(0, y)));
    }
    context.globalAlpha = 1;
    if (source.active && !source.lastSample?.pending) {
      const phase = clamp((source.lastSample?.positionBeats ?? 0) / Math.max(.001, d.heightBeats), 0, 1);
      const y = clamp(g.present - (d.delayBeats + phase * d.heightBeats) * g.pixelsPerBeat, top, bottom);
      context.strokeStyle = '#ffe0cf'; context.lineWidth = 1;
      context.beginPath(); context.moveTo(left, y); context.lineTo(right, y); context.stroke();
    }
  }
  for (const button of controlsHost.querySelectorAll('button[data-spigot-mode]')) listen(button, 'click', () => setMode(button.dataset.spigotMode));
  listen($('[data-spigot-deselect]'), 'click', () => setSelection(null));
  listen($('[data-spigot-play]'), 'click', () => { act(() => onTogglePlay?.(selectedId)); render(); });
  listen($('[data-spigot-loop]'), 'click', () => { const source = selected(); act(() => onToggleLoop?.(selectedId, !(source?.settings?.loop ?? source?.loop))); render(); });
  listen($('[data-spigot-remove]'), 'click', () => { const id = selectedId; setSelection(null); act(() => onRemove?.(id)); render(); });
  function pointerPoint(event) { const rect = viewport.getBoundingClientRect(); return spigotPoint(event.clientX - rect.left, event.clientY - rect.top, geometry()); }
  function beginBrush(point, pointerId = null, event = null) {
    if (brush || mode === 'select' || stampBusy) return;
    if (mode === 'erase' && !selectedId) { status('Select a layer to erase its notes.'); return; }
    const prepared = getPreparedScore();
    if (mode === 'stamp' && !prepared?.score?.buffer) { status('Choose or prepare a pattern first.'); return; }
    const handle = act(() => onBrushStart?.({ mode, sourceId: selectedId, ...point, prepared }));
    if (handle == null || handle === false) return;
    brush = { handle, pointerId, point, mode, startedAt: performance.now(), x: event?.clientX, y: event?.clientY, moved: 0 }; cursor = point;
    if (sources().some(source => source.id === handle)) setSelection(handle);
    if (mode !== 'erase') pulse = setInterval(() => { if (brush) act(() => onBrushMove?.(brush.handle, brush.point)); }, 33);
  }
  function endBrush(cancelled = false) {
    if (pulse !== null) { clearInterval(pulse); pulse = null; }
    if (!brush) return;
    const previous = brush; brush = null;
    if (!cancelled && previous.mode === 'draw' && previous.pointerId !== null && previous.moved <= 6 && performance.now() - previous.startedAt <= 350) {
      recentDrawGestures.push({ id: previous.handle, x: previous.x, y: previous.y, endedAt: performance.now() });
      recentDrawGestures = recentDrawGestures.slice(-2);
    } else if (previous.mode === 'draw') recentDrawGestures = [];
    if (previous.pointerId !== null && surface.hasPointerCapture?.(previous.pointerId)) surface.releasePointerCapture(previous.pointerId);
    act(() => onBrushEnd?.(previous.handle, { cancelled })); render();
  }
  listen(surface, 'pointerdown', event => {
    if (event.button !== 0 || !event.isPrimary) return;
    event.preventDefault(); surface.focus({ preventScroll: true }); surface.setPointerCapture(event.pointerId); beginBrush(pointerPoint(event), event.pointerId, event);
  });
  listen(surface, 'pointermove', event => {
    if (!brush || brush.pointerId !== event.pointerId) return;
    const coalesced = event.getCoalescedEvents?.();
    for (const sample of coalesced?.length ? coalesced : [event]) { brush.moved = Math.max(brush.moved, Math.hypot(sample.clientX - brush.x, sample.clientY - brush.y)); brush.point = pointerPoint(sample); cursor = brush.point; act(() => onBrushMove?.(brush.handle, brush.point)); }
  });
  listen(surface, 'pointerup', () => endBrush(false));
  listen(surface, 'dblclick', event => {
    if (mode !== 'draw' || event.button !== 0 || !onLatch) return;
    const near = recentDrawGestures.filter(gesture => performance.now() - gesture.endedAt <= 650
      && Math.hypot(event.clientX - gesture.x, event.clientY - gesture.y) <= 6);
    if (near.length !== 2) return;
    event.preventDefault(); recentDrawGestures = [];
    const id = act(() => onLatch({ ...pointerPoint(event), prepared: getPreparedScore(), replaceIds: near.map(gesture => gesture.id) }));
    if (id != null && sources().some(source => source.id === id)) setSelection(id);
    render();
  });
  for (const name of ['pointercancel', 'lostpointercapture']) listen(surface, name, () => endBrush(true));
  listen(surface, 'keydown', event => {
    const beat = event.shiftKey ? 1 : .25, pitch = event.shiftKey ? 12 : 1;
    const changes = { ArrowLeft: { pitch: cursor.pitch - pitch }, ArrowRight: { pitch: cursor.pitch + pitch }, ArrowUp: { delayBeats: cursor.delayBeats + beat }, ArrowDown: { delayBeats: cursor.delayBeats - beat } };
    if (changes[event.key]) { event.preventDefault(); cursor = { ...cursor, ...changes[event.key] }; cursor.pitch = clamp(cursor.pitch, 0, 127); cursor.delayBeats = clamp(cursor.delayBeats, 0, 64); if (brush) { brush.point = cursor; act(() => onBrushMove?.(brush.handle, cursor)); } status(`Pitch ${cursor.pitch} · delay ${cursor.delayBeats} beats`); }
    if (event.key === 'Enter' && !event.repeat) { event.preventDefault(); beginBrush(cursor); }
    if (event.key === 'Escape') { event.preventDefault(); setMode('select'); }
  });
  listen(surface, 'keyup', event => { if (event.key === 'Enter') endBrush(false); });
  function transformDrag(start, dx, dy, event) {
    if (start.kind === 'rotate') {
      const angle = Math.atan2(start.centerY - event.clientY, event.clientX - start.centerX);
      return { rotationDegrees: Math.round(degrees(start.rotationDegrees + (angle - start.angle) * 180 / Math.PI)) };
    }
    if (start.kind === 'move') return { transpose: start.transpose + dx, delayBeats: quarter(clamp(start.delayBeats - dy, 0, 64)) };
    const patch = {}, edge = start.kind;
    if (edge.includes('left') || edge.includes('right')) {
      const left = edge.includes('left') ? clamp(start.low + dx, 0, start.high) : start.low, right = edge.includes('right') ? clamp(start.high + dx, start.low, 127) : start.high;
      patch.widthNotes = Math.round(right - left + 1); patch.transpose = start.transpose + Math.round(left - start.low);
    }
    if (edge.includes('top') || edge.includes('bottom')) {
      patch.heightBeats = quarter(clamp(start.heightBeats + (edge.includes('top') ? -dy : dy), .25, 512));
      if (edge.includes('bottom')) { patch.heightBeats = Math.min(patch.heightBeats, start.heightBeats + start.delayBeats); patch.delayBeats = quarter(start.delayBeats + start.heightBeats - patch.heightBeats); }
    }
    return patch;
  }
  for (const control of overlay.querySelectorAll('.blech-spigot-move, .blech-spigot-grip, .blech-spigot-rotate')) {
    const kind = control.classList.contains('blech-spigot-move') ? 'move' : control.classList.contains('blech-spigot-rotate') ? 'rotate' : control.dataset.spigotResize;
    listen(control, 'pointerdown', event => {
      if (event.button !== 0 || !event.isPrimary || !selected()) return;
      event.preventDefault(); const source = selected(), rect = $('.blech-spigot-move').getBoundingClientRect();
      const centerX = rect.x + rect.width / 2, centerY = rect.y + rect.height / 2;
      cancelEdit();
      selection.dataset.dragging = 'true';
      drag = { id: event.pointerId, x: event.clientX, y: event.clientY, pointerPitch: pointerPoint(event).pitch, kind, ...source.settings, ...spigotDimensions(source), transpose: source.settings?.transpose ?? 0, rotationDegrees: source.settings?.rotationDegrees ?? 0, centerX, centerY, angle: Math.atan2(centerY - event.clientY, event.clientX - centerX), g: geometry() };
      control.setPointerCapture(event.pointerId); control.focus({ preventScroll: true });
    });
    listen(control, 'pointermove', event => { if (drag?.id === event.pointerId) queueEdit(transformDrag(drag, pointerPoint(event).pitch - drag.pointerPitch, (event.clientY - drag.y) / drag.g.pixelsPerBeat, event)); });
    listen(control, 'pointerup', () => { flushEdit(); drag = null; selection.dataset.dragging = 'false'; });
    for (const name of ['pointercancel', 'lostpointercapture']) listen(control, name, () => { cancelEdit(); drag = null; selection.dataset.dragging = 'false'; });
    listen(control, 'keydown', event => {
      const source = selected(); if (!source || !['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(event.key)) return;
      event.preventDefault(); const step = event.shiftKey ? 12 : 1, beat = event.shiftKey ? 1 : .25;
      if (kind === 'rotate') { edit({ rotationDegrees: degrees((source.settings?.rotationDegrees ?? 0) + (event.key === 'ArrowLeft' || event.key === 'ArrowDown' ? -step : step)) }); return; }
      edit(transformDrag({ kind, ...source.settings, ...spigotDimensions(source), transpose: source.settings?.transpose ?? 0 }, event.key === 'ArrowLeft' ? -step : event.key === 'ArrowRight' ? step : 0, event.key === 'ArrowUp' ? -beat : event.key === 'ArrowDown' ? beat : 0));
    });
  }
  listen(overlay, 'keydown', event => { if (event.key === 'Escape' && selectedId) { event.preventDefault(); setSelection(null); } });
  const cancelGesture = () => { cancelEdit(); recentDrawGestures = []; drag = null; selection.dataset.dragging = 'false'; endBrush(true); };
  listen(globalThis, 'blur', cancelGesture);
  listen(document, 'visibilitychange', () => { if (document.hidden) cancelGesture(); });
  const resize = new ResizeObserver(render); resize.observe(viewport); render();
  return { refresh: render, refreshStamps, cancelGesture, setMode, select: setSelection, getMode: () => mode, getSelection: () => selectedId,
    dispose() { if (disposed) return; cancelEdit(); stampTicket++; endBrush(true); stampMenu?.dispose(); disposed = true; events.abort(); resize.disconnect(); overlay.remove(); if (ownedHost) controlsHost.remove(); else controlsHost.replaceChildren(); },
  };
}

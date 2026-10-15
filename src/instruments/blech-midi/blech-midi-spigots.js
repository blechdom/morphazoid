import { blackMidiKeyLayout, blackMidiTimeGeometry } from './blech-midi-black-renderer.js';
import { midiStampPitchBounds } from '../midi-mixer/midi-mixer-score-transform.js';

const clamp = (value, min, max, fallback = min) => Math.max(min, Math.min(max, Number.isFinite(Number(value)) ? Number(value) : fallback));
const quarter = value => Math.round(value * 4) / 4;
const degrees = value => ((value % 360) + 360) % 360;
const MODES = ['select', 'stamp', 'draw'];

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

/** Persistent source handles; the owner owns all audio clocks, notes and source state. */
export function mountBlechSpigots(viewport, {
  controlsHost, getLayers = () => [], getPreparedScore = () => null, getTempo = () => 120, getView = () => ({}),
  onCreate, onEdit, onToggleLoop, onTogglePlay, onRemove, onBrushStart, onBrushMove, onBrushEnd, onModeChange, onSelectionChange,
} = {}) {
  const events = new AbortController(), listen = (node, type, callback) => node.addEventListener(type, callback, { signal: events.signal });
  const ownedHost = !controlsHost;
  if (!controlsHost) { controlsHost = document.createElement('div'); viewport.before(controlsHost); }
  controlsHost.classList.add('blech-spigot-controls');
  controlsHost.innerHTML = `<div class="blech-spigot-mode" role="group" aria-label="Canvas tool">${MODES.map(mode => `<button type="button" data-spigot-mode="${mode}" aria-pressed="${mode === 'select'}">${mode[0].toUpperCase() + mode.slice(1)}</button>`).join('')}<output data-spigot-status role="status">Select a source, or stamp or draw into the flow.</output></div>
    <div class="blech-spigot-editor" hidden><b data-spigot-title></b><label>Pitch<input data-spigot-field="transpose" aria-label="Source pitch offset" type="number" min="-127" max="127" step="1"></label><label>Delay<input data-spigot-field="delayBeats" aria-label="Source delay in beats" type="number" min="0" max="64" step=".25"></label><label>Width<input data-spigot-field="widthNotes" aria-label="Source width in notes" type="number" min="1" max="128" step="1"></label><label>Height<input data-spigot-field="heightBeats" aria-label="Source height in beats" type="number" min=".25" max="512" step=".25"></label><label>Rotate<input data-spigot-field="rotationDegrees" aria-label="Source rotation in degrees" type="number" min="0" max="359" step="1"></label></div>`;
  const overlay = document.createElement('div'); overlay.className = 'blech-spigot-overlay';
  overlay.innerHTML = `<canvas class="blech-spigot-preview" aria-label="Selected MIDI source pattern"></canvas><div class="blech-spigot-paint" tabindex="-1" role="group" aria-label="MIDI flow canvas. Arrow keys position; hold Enter to stamp or draw; Escape selects." data-space-key-owner></div><div class="blech-spigot-sources"></div><div class="blech-spigot-selection" hidden><button type="button" class="blech-spigot-move" aria-label="Move source; arrows change pitch and delay" data-space-key-owner></button>${['left','right','top','bottom','top-left','top-right','bottom-left','bottom-right'].map(edge => `<button type="button" class="blech-spigot-grip" data-spigot-resize="${edge}" aria-label="Resize source ${edge.replace('-', ' ')}; arrow keys adjust" data-space-key-owner></button>`).join('')}<button type="button" class="blech-spigot-rotate" aria-label="Rotate source; left and right arrows change angle" data-space-key-owner>↻</button><div class="blech-spigot-valves"><button type="button" data-spigot-play aria-label="Pause source">Ⅱ</button><button type="button" data-spigot-loop aria-label="Loop source" aria-pressed="false">↻</button><button type="button" data-spigot-remove aria-label="Remove source">×</button><button type="button" data-spigot-deselect aria-label="Deselect source">✓</button></div></div>`;
  viewport.append(overlay);
  const $ = selector => overlay.querySelector(selector), c$ = selector => controlsHost.querySelector(selector);
  const canvas = $('canvas'), context = canvas.getContext('2d'), surface = $('.blech-spigot-paint'), selection = $('.blech-spigot-selection'), editor = c$('.blech-spigot-editor');
  const nodes = new Map();
  let mode = 'select', selectedId = null, disposed = false, drag = null, brush = null, pulse = null, cursor = { pitch: 64, delayBeats: 2 };
  const geometry = () => { const rect = viewport.getBoundingClientRect(); return spigotGeometry(rect.width, rect.height, getTempo(), getView()); };
  const sources = () => getLayers() ?? [];
  const selected = () => sources().find(source => source.id === selectedId);
  const status = text => { c$('[data-spigot-status]').value = text; };
  const act = callback => { try { return callback?.(); } catch (error) { status(error.message); return null; } };
  function setSelection(id) {
    selectedId = id; onSelectionChange?.(id); render();
  }
  function dimensions(source) {
    const notes = source.score?.analysis?.notes ?? [], pitch = midiStampPitchBounds(notes), settings = source.settings ?? source;
    return { ...pitch, heightBeats: source.score?.analysis?.durationBeats ?? settings.heightBeats ?? 1, delayBeats: settings.delayBeats ?? 2 };
  }
  function setMode(next) {
    if (!MODES.includes(next)) return;
    endBrush(true); drag = null; mode = next;
    if (mode !== 'select') setSelection(null);
    onModeChange?.(mode); render();
    status(mode === 'select' ? 'Select a source to move, resize or rotate it.' : mode === 'stamp' ? 'Tap to place the selected pattern. Hold to repeat it.' : 'Hold and draw into the flow. Hold still for a line.');
  }
  function edit(patch) {
    if (!selectedId) return;
    act(() => onEdit?.(selectedId, patch)); render();
  }
  function render() {
    if (disposed) return;
    const g = geometry(); if (!g.width || !g.height) return;
    const coarse = globalThis.matchMedia?.('(pointer: coarse)').matches, targetSize = coarse ? 48 : 28, valveHeight = coarse ? 48 : 30, valveWidth = coarse ? 201 : 145;
    overlay.style.height = `${Math.max(0, g.present - 2)}px`; canvas.style.height = `${g.height}px`;
    overlay.dataset.mode = mode; surface.style.height = `${Math.max(0, g.present - 2)}px`; surface.tabIndex = mode === 'select' ? -1 : 0;
    for (const button of controlsHost.querySelectorAll('[data-spigot-mode]')) button.setAttribute('aria-pressed', String(button.dataset.spigotMode === mode));
    const current = sources(), ids = new Set(current.map(source => source.id));
    for (const [id, node] of nodes) if (!ids.has(id)) { node.remove(); nodes.delete(id); }
    if (selectedId && !ids.has(selectedId)) { selectedId = null; onSelectionChange?.(null); }
    const occupied = [], centers = [];
    current.forEach((source, index) => {
      let node = nodes.get(source.id);
      if (!node) {
        node = document.createElement('button'); node.type = 'button'; node.className = 'blech-spigot-emitter'; node.dataset.spigotId = source.id;
        listen(node, 'click', () => setSelection(source.id)); $('.blech-spigot-sources').append(node); nodes.set(source.id, node);
      }
      const d = dimensions(source), key = g.layout[Math.round(clamp((d.low + d.high) / 2, 0, 127))];
      const anchorX = (key.x + key.width / 2) * g.width, anchorY = g.present - d.delayBeats * g.pixelsPerBeat;
      let x = clamp(anchorX, targetSize / 2, Math.max(targetSize / 2, g.width - targetSize / 2));
      let y = clamp(anchorY, targetSize / 2, Math.max(targetSize / 2, g.present - targetSize / 2 - 2));
      const baseX = x, baseY = y, spacing = targetSize + 4;
      for (let attempt = 0; attempt < 96; attempt++) {
        const direction = attempt % 2 ? -1 : 1, column = Math.ceil((attempt % 16) / 2), row = Math.floor(attempt / 16);
        const trialX = clamp(baseX + direction * column * spacing, targetSize / 2, Math.max(targetSize / 2, g.width - targetSize / 2));
        const trialY = clamp(baseY + (row % 2 ? -1 : 1) * Math.ceil(row / 2) * spacing, targetSize / 2, Math.max(targetSize / 2, g.present - targetSize / 2 - 2));
        if (!occupied.some(point => Math.abs(point.x - trialX) < spacing && Math.abs(point.y - trialY) < spacing)) { x = trialX; y = trialY; break; }
      }
      occupied.push({ x, y }); centers.push({ x, y, anchorX, anchorY });
      node.style.left = `${x}px`; node.style.top = `${y}px`;
      node.textContent = `${index + 1}${source.open ? '●' : '○'}`;
      node.title = `${source.name || 'Source'} · ${source.pendingEdit ? 'changes next loop' : source.paused ? 'paused' : source.open ? 'open' : 'closed'}`;
      node.setAttribute('aria-label', `Select ${source.name || 'source'} ${index + 1}`);
      node.setAttribute('aria-pressed', String(source.id === selectedId)); node.dataset.open = String(Boolean(source.open));
    });
    const dpr = Math.min(devicePixelRatio || 1, 2); canvas.width = Math.round(g.width * dpr); canvas.height = Math.round(g.height * dpr); context.setTransform(dpr, 0, 0, dpr, 0, 0);
    context.strokeStyle = '#c9442070'; context.lineWidth = 1;
    for (const marker of centers) { context.beginPath(); context.moveTo(marker.x, marker.y); context.lineTo(marker.anchorX, clamp(marker.anchorY, 0, g.present)); context.stroke(); }
    const source = selected(); selection.hidden = !source || mode !== 'select'; editor.hidden = !source || mode !== 'select';
    if (!source) return;
    const settings = source.settings ?? source, d = dimensions(source);
    c$('[data-spigot-title]').textContent = source.name || 'Source';
    for (const field of controlsHost.querySelectorAll('[data-spigot-field]')) {
      if (document.activeElement === field) continue;
      const fallback = field.dataset.spigotField === 'widthNotes' ? d.width : field.dataset.spigotField === 'heightBeats' ? d.heightBeats : 0;
      field.value = String(settings[field.dataset.spigotField] ?? fallback);
    }
    const low = g.layout[Math.round(clamp(d.low, 0, 127))], high = g.layout[Math.round(clamp(d.high, 0, 127))];
    const left = clamp(low.x * g.width, 2, Math.max(2, g.width - 24)), right = clamp((high.x + high.width) * g.width, left + 24, g.width - 2);
    const bottom = clamp(g.present - d.delayBeats * g.pixelsPerBeat, 28, g.present - 2), top = clamp(g.present - (d.delayBeats + d.heightBeats) * g.pixelsPerBeat, 2, bottom - 24);
    Object.assign($('.blech-spigot-move').style, { left: `${left}px`, top: `${top}px`, width: `${right - left}px`, height: `${bottom - top}px` });
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
  }
  for (const button of controlsHost.querySelectorAll('[data-spigot-mode]')) listen(button, 'click', () => setMode(button.dataset.spigotMode));
  for (const field of controlsHost.querySelectorAll('[data-spigot-field]')) listen(field, 'change', () => { edit({ [field.dataset.spigotField]: Number(field.value) }); field.blur(); render(); });
  listen($('[data-spigot-deselect]'), 'click', () => setSelection(null));
  listen($('[data-spigot-play]'), 'click', () => { act(() => onTogglePlay?.(selectedId)); render(); });
  listen($('[data-spigot-loop]'), 'click', () => { const source = selected(); act(() => onToggleLoop?.(selectedId, !(source?.settings?.loop ?? source?.loop))); render(); });
  listen($('[data-spigot-remove]'), 'click', () => { const id = selectedId; setSelection(null); act(() => onRemove?.(id)); render(); });
  function pointerPoint(event) { const rect = viewport.getBoundingClientRect(); return spigotPoint(event.clientX - rect.left, event.clientY - rect.top, geometry()); }
  function beginBrush(point, pointerId = null) {
    if (brush || mode === 'select') return;
    const prepared = getPreparedScore();
    if (mode === 'stamp' && !prepared?.score?.buffer) { status('Choose or prepare a pattern first.'); return; }
    const handle = act(() => onBrushStart?.({ mode, ...point, prepared }));
    if (handle == null || handle === false) return;
    brush = { handle, pointerId, point }; cursor = point;
    pulse = setInterval(() => { if (brush) act(() => onBrushMove?.(brush.handle, brush.point)); }, 33);
  }
  function endBrush(cancelled = false) {
    if (pulse !== null) { clearInterval(pulse); pulse = null; }
    if (!brush) return;
    const previous = brush; brush = null;
    if (previous.pointerId !== null && surface.hasPointerCapture?.(previous.pointerId)) surface.releasePointerCapture(previous.pointerId);
    act(() => onBrushEnd?.(previous.handle, { cancelled })); render();
  }
  listen(surface, 'pointerdown', event => {
    if (event.button !== 0 || !event.isPrimary) return;
    event.preventDefault(); surface.focus({ preventScroll: true }); surface.setPointerCapture(event.pointerId); beginBrush(pointerPoint(event), event.pointerId);
  });
  listen(surface, 'pointermove', event => {
    if (!brush || brush.pointerId !== event.pointerId) return;
    const coalesced = event.getCoalescedEvents?.();
    for (const sample of coalesced?.length ? coalesced : [event]) { brush.point = pointerPoint(sample); cursor = brush.point; act(() => onBrushMove?.(brush.handle, brush.point)); }
  });
  listen(surface, 'pointerup', () => endBrush(false));
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
      drag = { id: event.pointerId, x: event.clientX, y: event.clientY, kind, ...source.settings, ...dimensions(source), transpose: source.settings?.transpose ?? 0, rotationDegrees: source.settings?.rotationDegrees ?? 0, centerX, centerY, angle: Math.atan2(centerY - event.clientY, event.clientX - centerX), g: geometry() };
      control.setPointerCapture(event.pointerId); control.focus({ preventScroll: true });
    });
    listen(control, 'pointermove', event => { if (drag?.id === event.pointerId) edit(transformDrag(drag, Math.round((event.clientX - drag.x) / drag.g.width * 128), (event.clientY - drag.y) / drag.g.pixelsPerBeat, event)); });
    for (const name of ['pointerup', 'pointercancel', 'lostpointercapture']) listen(control, name, () => { drag = null; });
    listen(control, 'keydown', event => {
      const source = selected(); if (!source || !['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(event.key)) return;
      event.preventDefault(); const step = event.shiftKey ? 12 : 1, beat = event.shiftKey ? 1 : .25;
      if (kind === 'rotate') { edit({ rotationDegrees: degrees((source.settings?.rotationDegrees ?? 0) + (event.key === 'ArrowLeft' || event.key === 'ArrowDown' ? -step : step)) }); return; }
      edit(transformDrag({ kind, ...source.settings, ...dimensions(source), transpose: source.settings?.transpose ?? 0 }, event.key === 'ArrowLeft' ? -step : event.key === 'ArrowRight' ? step : 0, event.key === 'ArrowUp' ? -beat : event.key === 'ArrowDown' ? beat : 0));
    });
  }
  listen(globalThis, 'blur', () => { drag = null; endBrush(true); });
  listen(document, 'visibilitychange', () => { if (document.hidden) { drag = null; endBrush(true); } });
  const resize = new ResizeObserver(render); resize.observe(viewport); render();
  return { refresh: render, cancelGesture() { drag = null; endBrush(true); }, setMode, select: setSelection, getMode: () => mode,
    dispose() { if (disposed) return; endBrush(true); disposed = true; events.abort(); resize.disconnect(); overlay.remove(); nodes.clear(); if (ownedHost) controlsHost.remove(); else controlsHost.replaceChildren(); },
  };
}

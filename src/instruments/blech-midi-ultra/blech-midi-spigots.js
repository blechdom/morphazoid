import { blackMidiKeyLayout, blackMidiKeyboardPitch, blackMidiPitchAtX, blackMidiPixelLayout, blackMidiTimeGeometry } from './blech-midi-black-renderer.js';
import { midiStampPitchBounds } from '../midi-mixer/midi-mixer-score-transform.js';
import { mountBlechStampPicker } from './blech-midi-stamp-picker.js';
import { blechGeometryNotes } from './blech-midi-spigot-engine.js';

const clamp = (value, min, max, fallback = min) => Math.max(min, Math.min(max, Number.isFinite(Number(value)) ? Number(value) : fallback));
const quarter = value => Math.round(value * 4) / 4;
const degrees = value => ((value % 360) + 360) % 360;
const MODES = ['select', 'draw', 'erase', 'stamp', 'math'];
const TOOL_ICONS = {
  draw: '<path d="M4 16 3 21l5-1L20 8l-4-4L4 16Z"/><path d="m14 6 4 4M4 16l4 4"/>',
  erase: '<path d="m4 13 9-9a2 2 0 0 1 3 0l5 5a2 2 0 0 1 0 3l-9 9H7l-4-4a3 3 0 0 1 1-4Z"/><path d="m8 9 8 8M12 21h10"/>',
  stamp: '<path d="M9 5a3 3 0 0 1 6 0c0 1.5-.7 2.3-1.5 3v3l3 4h-9l3-4V8C9.7 7.3 9 6.5 9 5Z"/><rect x="5" y="16" width="14" height="3" rx=".5"/><path d="M4 21h16"/>',
};
const toolIcon = mode => `<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">${TOOL_ICONS[mode]}</svg>`;
const noteName = pitch => `${['C', 'C♯', 'D', 'D♯', 'E', 'F', 'F♯', 'G', 'G♯', 'A', 'A♯', 'B'][pitch % 12]}${Math.floor(pitch / 12) - 1}`;

/** Tap for every pitch. Holding chooses equally sized on/off blocks across
 * the 128-key row; the pattern always starts with the first pitch on.
 */
export function blechCombBlock(milliseconds) {
  if (!Number.isFinite(milliseconds) || milliseconds < 420) return 0;
  // Leave time to see and release on each block size, even on a busy canvas.
  return Math.min(8, 1 + Math.floor((milliseconds - 420) / 1000));
}
const combPitchOn = (pitch, block) => block === 0 || pitch % (2 * block) < block;
export function blechCombNotes(block = 0) {
  const size = Math.floor(clamp(block, 0, 8, 0));
  return Array.from({ length: 128 }, (_, pitch) => pitch)
    .filter(pitch => combPitchOn(pitch, size))
    .map(note => ({ note, channel: 0, velocity: 64, beat: 0, duration: .25 }));
}
const combName = block => block === 0 ? 'Every pitch' : `${block} on / ${block} off`;

const CROSSING_PERIODS = [1 / 8, 1 / 4, 1 / 2, 1, 2, 4, 8];
const periodLabel = period => period < 1 ? `1/${1 / period}` : String(period);

/** A corner tap keeps its last subdivision; holding chooses a slower one. */
export function blechCrossingPeriod(milliseconds, selected = 1 / 8) {
  const current = CROSSING_PERIODS.includes(selected) ? selected : 1 / 8;
  if (!Number.isFinite(milliseconds) || milliseconds < 250) return current;
  return CROSSING_PERIODS[Math.min(CROSSING_PERIODS.length - 1, 1 + Math.floor((milliseconds - 250) / 550))];
}

/** The upper corner repeats the *selected* Comb pitch blocks at its beat
 * subdivision. Keep one bounded, audio-clocked clip rather than 128 emitters. */
export function blechCrossingNotes(block = 0, periodBeats = 1 / 8) {
  const size = Math.floor(clamp(block, 0, 8, 0));
  const period = CROSSING_PERIODS.includes(periodBeats) ? periodBeats : 1 / 8;
  const beats = Math.max(4, period);
  const notes = [];
  for (let step = 0; step < beats / period; step++) {
    for (let pitch = 0; pitch < 128; pitch++) {
      if (combPitchOn(pitch, size))
        notes.push({ note: pitch, channel: 0, velocity: 56, beat: step * period, duration: period / 2 });
    }
  }
  return notes;
}

/** Tap for the quickest safe gate; longer presses double the beat interval.
 * The MIDI score and Audio clock own the pulses, never a graphics timer. */
export function blechRailPeriod(milliseconds) {
  const choices = [.25, .5, 1, 2, 4, 8];
  const held = Number.isFinite(milliseconds) ? Math.max(0, milliseconds) : 0;
  return choices[Math.min(choices.length - 1, held < 250 ? 0 : 1 + Math.floor((held - 250) / 550))];
}

/** The future plane shares the renderer's pitch positions and audio-time scale. */
export function spigotGeometry(width, height, tempo = 120, view = {}) {
  const time = blackMidiTimeGeometry(view, height, width);
  return { width, height, present: time.keyboardTop * height, pixelsPerBeat: time.velocity * height * 60 / clamp(tempo, 1, 4800, 120), layout: blackMidiKeyLayout(view.alignment) };
}
export function spigotPoint(x, y, geometry) {
  const position = clamp(x / Math.max(1, geometry.width), 0, 1);
  const pitch = blackMidiPitchAtX(position, geometry.layout);
  return { pitch, delayBeats: quarter(clamp((geometry.present - y) / Math.max(.001, geometry.pixelsPerBeat), 0, 64)) };
}
export function spigotPlacement(score, settings, point) {
  const pitch = midiStampPitchBounds(score?.analysis?.notes ?? [], null, score?.pitchRange);
  const transpose = Math.round(clamp(point.pitch - (pitch.low + pitch.high) / 2, -pitch.low, 127 - pitch.high, 0));
  return { ...settings, transpose, delayBeats: point.delayBeats };
}
/** The chosen pitch/time sits near the middle of a Free Math shape. Keep its
 * entire four-beat (or shorter) envelope on the visible future plane. */
export function freeMathPlacement(score, settings, point, geometry) {
  const height = score.analysis.durationBeats;
  const room = Math.max(0, Math.floor((geometry.present / geometry.pixelsPerBeat - height) * 4) / 4);
  const delayBeats = quarter(clamp(point.delayBeats - height / 2, 0, Math.min(64, room)));
  return spigotPlacement(score, settings, { ...point, delayBeats });
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
  controlsHost, eraseControl, stampHost, combHost, getLayers = () => [], getLiveSources = () => [], getPreparedScore = () => null, getTempo = () => 120, getView = () => ({}),
  getBrush = () => ({ size: 1, velocity: 88 }), getDrawingGesture = () => ({ tool: 'pencil', fill: 'outline' }),
  getStampEntries = () => [], getSelectedStampId = () => null, onSelectStamp,
  onCreate, onCreateMath, onCreateComb, onCreateCrossing, onCreateRail, onEdit, onOpenSettings, onToggleLoop, onTogglePlay, onRemove,
  onBrushStart, onBrushMove, onBrushEnd, onLatch, onGeometryDraft, onModeChange, onSelectionChange,
} = {}) {
  const events = new AbortController(), listen = (node, type, callback) => node.addEventListener(type, callback, { signal: events.signal });
  const ownedHost = !controlsHost;
  if (!controlsHost) { controlsHost = document.createElement('div'); viewport.before(controlsHost); }
  controlsHost.classList.add('blech-spigot-controls');
  controlsHost.innerHTML = `<div class="blech-spigot-mode" role="group" aria-label="Canvas tools"><button type="button" data-spigot-mode="draw" aria-label="Free Draw" title="Free Draw · play once as you draw${stampHost ? '; corner arrow or Down Arrow opens brushes' : ''}" aria-pressed="false"${stampHost ? ' aria-expanded="false" aria-controls="blechBrushMenu" aria-haspopup="dialog" aria-keyshortcuts="ArrowDown"' : ''}>${toolIcon('draw')}${stampHost ? '<span id="blechBrushToggle" class="blech-icon-caret" aria-hidden="true"><svg viewBox="0 0 16 8"><path d="m4 2 4 4 4-4"/></svg></span>' : ''}</button>${eraseControl ? '' : `<button type="button" data-spigot-mode="erase" aria-label="Eraser" title="Eraser" aria-pressed="false">${toolIcon('erase')}</button>`}${stampHost ? '' : '<div data-spigot-stamp-picker></div>'}<output data-spigot-status role="status">Choose a tool, or select a layer to reshape it.</output></div>`;
  if (combHost) {
    combHost.classList.add('blech-pitch-comb');
    combHost.innerHTML = `<button type="button" data-comb-surface aria-label="Pitch comb. Tap to play every key once; hold to choose one on, one off, then two on, two off, and larger blocks across the keyboard. Drag up to delay; double-click to delete the last row. Up and Down move the row in time." title="Tap: all keys once · hold: 1 on / 1 off, 2 on / 2 off… · drag up: delay · double-click: delete last row" data-space-key-owner><span class="blech-comb-icon" aria-hidden="true">≡</span><span>COMB</span><output data-comb-status aria-live="polite">ALL</output><span class="blech-comb-markers" aria-hidden="true"></span></button>${onCreateCrossing ? '<button type="button" class="blech-rail-crossing" data-rail-crossing aria-label="Loop the selected Comb pattern every eighth of a beat; hold to choose another subdivision" aria-pressed="false" title="Loop this pitch pattern · hold to choose a beat subdivision · tap again to stop" data-space-key-owner><svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M4 4v16M12 4v16M20 4v16M4 4h16M4 12h16M4 20h16"/></svg><span class="blech-crossing-rate" aria-hidden="true">1/8</span></button>' : ''}`;
  }
  const overlay = document.createElement('div'); overlay.className = 'blech-spigot-overlay';
  overlay.innerHTML = `<canvas class="blech-spigot-preview" aria-label="Drawing preview and selected MIDI source pattern"></canvas><div class="blech-spigot-paint" tabindex="-1" role="group" aria-label="MIDI flow canvas. Arrow keys position; hold Enter to draw, erase or stamp; Escape returns to layer editing." data-space-key-owner></div><div class="blech-spigot-notice" aria-hidden="true" hidden></div><div class="blech-spigot-sources"></div><div class="blech-spigot-selection" hidden><button type="button" class="blech-spigot-move" aria-label="Move source; arrows change pitch and delay" data-space-key-owner></button>${['left','right','top','bottom','top-left','top-right','bottom-left','bottom-right'].map(edge => `<button type="button" class="blech-spigot-grip" data-spigot-resize="${edge}" aria-label="Resize source ${edge.replace('-', ' ')}; arrow keys adjust" data-space-key-owner></button>`).join('')}<button type="button" class="blech-spigot-rotate" aria-label="Rotate source; left and right arrows change angle" data-space-key-owner>↻</button><div class="blech-spigot-valves" role="toolbar" aria-label="Layer workbox actions"><button type="button" data-spigot-play aria-label="Pause source" title="Play or pause this layer">Ⅱ</button><button type="button" data-spigot-loop aria-label="Loop source" title="Loop this layer" aria-pressed="false">↻</button><button type="button" data-spigot-deselect aria-label="Keep in Layers and close frame" title="Save to Layers · keep playing">✓</button><button type="button" data-spigot-remove aria-label="Remove source" title="Cancel · remove and stop this layer">×</button><button type="button" data-spigot-settings aria-label="Edit frame geometry and instrument" aria-expanded="false" aria-controls="blechLayerEditor" title="MIDI and workbox settings">⚙</button><button type="button" data-spigot-transform aria-label="Transform drawn frame" title="Move, resize and rotate this frame">⌖</button></div></div>`;
  viewport.append(overlay);
  // Give the rail its own row above the playable viewport. A standalone
  // canvas fixture without that column keeps the old overlay placement.
  const noteRail = document.createElement('div'); noteRail.className = 'blech-note-rail';
  noteRail.innerHTML = `<canvas class="blech-note-rail-grid" aria-hidden="true"></canvas><button type="button" class="blech-note-rail-surface" data-note-rail data-space-key-owner title="Tap for fast repeat · hold for slower repeat · double-tap to sustain · tap a square to remove"></button><span class="blech-note-rail-cursor" aria-hidden="true"></span><span class="blech-note-rail-preview" aria-hidden="true" hidden></span><span class="blech-note-rail-markers"></span><output class="blech-note-rail-status sr-only" role="status"></output>`;
  const railColumn = viewport.parentElement?.classList.contains('blech-file-note-column') ? viewport.parentElement : null;
  if (railColumn) railColumn.prepend(noteRail);
  else { noteRail.classList.add('is-overlay'); viewport.append(noteRail); }
  const $ = selector => overlay.querySelector(selector), c$ = selector => controlsHost.querySelector(selector);
  const canvas = $('.blech-spigot-preview'), context = canvas.getContext('2d'), notice = $('.blech-spigot-notice');
  const surface = $('.blech-spigot-paint'), selection = $('.blech-spigot-selection'), combSurface = combHost?.querySelector('[data-comb-surface]');
  const crossingSurface = combHost?.querySelector('[data-rail-crossing]');
  const railSurface = noteRail.querySelector('[data-note-rail]'), railPreview = noteRail.querySelector('.blech-note-rail-preview');
  const railGrid = noteRail.querySelector('.blech-note-rail-grid'), railGridContext = railGrid.getContext('2d');
  const railMarkers = noteRail.querySelector('.blech-note-rail-markers'), railCursorMark = noteRail.querySelector('.blech-note-rail-cursor');
  const railStatus = noteRail.querySelector('.blech-note-rail-status');
  const modeButtons = [c$('[data-spigot-mode="draw"]'), eraseControl ?? c$('[data-spigot-mode="erase"]')];
  $('.blech-spigot-sources').remove();
  const label = document.createElement('div'); label.className = 'blech-spigot-label'; selection.append(label);
  const move = $('.blech-spigot-move');
  let mode = 'select', selectedId = null, disposed = false, drag = null, brush = null, shapeDraft = null, pulse = null, cursor = { pitch: 64, delayBeats: 2 };
  let mathDraft = null, mathPointerId = null, mathFrame = null, mathDirty = false;
  const MAX_LINE_ANCHORS = 64;
  let shapeFrame = null;
  let combGesture = null, combPulse = null, combDelayBeats = 2, combLastBlock = 0, combCreated = [], recentCombGestures = [], suppressValvesUntil = 0, revealTimer = null;
  let crossingGesture = null, crossingPulse = null, crossingPeriod = 1 / 8, suppressCrossingActivation = false, crossingActivationTimer = null;
  let railGesture = null, railPulse = null, railCursor = 60, lastRailTap = null, railSignature = '', railGridAlignment = '', suppressRailActivation = false;
  let pendingEdit = null, editTimer = null, stampTicket = 0, stampBusy = false, stampMenu = null, recentDrawGestures = [];
  let previewHasInk = false;
  const geometry = () => { const rect = viewport.getBoundingClientRect(); return spigotGeometry(rect.width, rect.height, getTempo(), getView()); };
  const sources = () => getLayers() ?? [];
  const liveSources = () => getLiveSources() ?? [];
  const selected = () => sources().find(source => source.id === selectedId);
  const status = (text, error = false) => {
    c$('[data-spigot-status]').value = text;
    notice.hidden = !error; if (error) notice.textContent = text;
  };
  const act = callback => { try { return callback?.(); } catch (error) { status(error.message, true); return null; } };
  function setSelection(id) {
    cancelEdit(); drag = null; selection.dataset.dragging = 'false';
    if (!id) { clearTimeout(revealTimer); revealTimer = null; suppressValvesUntil = 0; }
    selectedId = id; onSelectionChange?.(id); render();
  }
  function setMode(next) {
    if (!MODES.includes(next)) return;
    endBrush(true); finishGeometryDraft(true); finishComb(true); cancelEdit(); drag = null; selection.dataset.dragging = 'false'; mode = next;
    if (next !== 'math') {
      mathDraft = null; mathPointerId = null;
      if (mathFrame !== null) { cancelAnimationFrame(mathFrame); mathFrame = null; }
    }
    // Free Draw stays unboxed and out of Layers. Free Stamp and Free Math can
    // still be selected from Layers for later editing.
    if (next === 'draw' || next === 'stamp' || next === 'math') setSelection(null);
    else if (next === 'erase' && !selected()) setSelection(sources().at(-1)?.id ?? null);
    clearTimeout(revealTimer); revealTimer = null; suppressValvesUntil = 0;
    stampTicket++; stampBusy = false; recentDrawGestures = []; recentCombGestures = []; stampMenu?.close(); decorateStampPicker();
    onModeChange?.(mode); render(true);
    updateDrawingStatus();
  }
  function updateDrawingStatus() {
    const tool = getDrawingGesture(mode)?.tool ?? 'pencil';
    status(mode === 'select' ? 'Select a layer to move, resize or rotate it.'
      : mode === 'math' ? `${mathDraft?.settings.name ?? 'Math shape'} · tap to place once. Tap again to place another; Escape cancels.`
      : mode === 'stamp' ? 'Tap to place this stamp. Hold for a longer phrase.'
        : mode === 'erase' ? 'Drag across notes in the selected layer to erase them.'
          : tool === 'line' ? 'Click to join line anchors; double-click to play the whole line once. Space finishes with the keyboard.'
            : tool !== 'pencil' ? `Drag a ${tool}; release to play it once.`
            : 'Draw notes once as you go; double-click to latch a note.');
  }
  function decorateStampPicker() {
    if (!stampMenu || stampHost) return; // The Free Stamp button owns the mode; the menu shows the chosen thumbnail.
    const summary = stampMenu.element.querySelector('summary');
    summary.dataset.spigotMode = 'stamp';
    summary.setAttribute('aria-pressed', String(mode === 'stamp'));
    summary.setAttribute('aria-busy', String(stampBusy));
    const current = stampMenu.element.querySelector('.instrument-picker-current');
    current.innerHTML = toolIcon('stamp');
  }
  function refreshStamps() {
    if (disposed || !stampMenu) return [];
    return act(() => {
      const entries = getStampEntries();
      stampMenu.update(entries);
      const id = getSelectedStampId(); if (id != null) stampMenu.select(id);
      decorateStampPicker();
      return entries;
    }) ?? [];
  }
  async function chooseStamp(id, entry) {
    const ticket = ++stampTicket; stampBusy = true; decorateStampPicker();
    status(`Preparing ${entry.title ?? entry.label ?? id}…`);
    try {
      const result = await onSelectStamp?.(id, entry);
      if (disposed || ticket !== stampTicket) return;
      if (result === false) { stampBusy = false; refreshStamps(); status('Stamp was not prepared. Choose another stamp.', true); return; }
      setMode('stamp');
      decorateStampPicker();
      surface.focus({ preventScroll: true });
    } catch (error) {
      if (!disposed && ticket === stampTicket) { stampBusy = false; refreshStamps(); status(error.message || 'Could not prepare this stamp.', true); }
    }
  }
  function activateStamp() {
    if (disposed || stampBusy) return;
    if (getPreparedScore('stamp')?.score?.buffer) { setMode('stamp'); return; }
    const entries = refreshStamps();
    const id = getSelectedStampId() ?? stampMenu.value;
    const entry = entries.find(candidate => String(candidate.id) === String(id));
    if (entry) void chooseStamp(id, entry);
    else status('Choose a stamp in Free Stamp options.', true);
  }
  stampMenu = mountBlechStampPicker(stampHost ?? c$('[data-spigot-stamp-picker]'), {
    entries: [], onSelect: chooseStamp, label: stampHost ? 'Free Stamp picture' : 'Stamp', selectedId: getSelectedStampId(),
    placeholder: 'Find a shape or MIDI stamp', filterLabel: 'Filter canvas stamps', listLabel: 'Canvas stamps',
  });
  stampMenu.element.classList.add('blech-spigot-stamp-picker');
  if (stampHost) stampMenu.element.classList.add('blech-stamp-grid-picker');
  else stampMenu.element.querySelector('.instrument-picker-panel').classList.add('blech-spigot-stamp-grid');
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
  function combLabel(block) {
    const output = combSurface.querySelector('[data-comb-status]'), text = block === 0 ? 'ALL' : `${block} ON\n${block} OFF`;
    if (output.value !== text) output.value = text;
    combSurface.dataset.block = String(block);
  }
  function drawCombPreview(g, pixels, scale) {
    if (!combGesture) return;
    const block = blechCombBlock(performance.now() - combGesture.startedAt), y = g.present - combGesture.delayBeats * g.pixelsPerBeat;
    context.fillStyle = '#ffc099'; context.globalAlpha = .9;
    for (let pitch = 0; pitch < 128; pitch++) {
      if (!combPitchOn(pitch, block)) continue;
      const key = pixels[pitch];
      context.fillRect(key.left / scale, clamp(y - 2, 0, g.present - 4), key.noteWidth / scale, 4);
    }
    context.globalAlpha = 1;
    combLabel(block);
    combSurface.dataset.holding = 'true';
  }
  function drawMathPreview(g, pixels, scale) {
    if (mode !== 'math' || !mathDraft) return;
    const { score, settings } = mathDraft, notes = score.analysis.notes;
    const placed = freeMathPlacement(score, settings, cursor, g);
    const pitch = midiStampPitchBounds(notes, null, score.pitchRange);
    const low = g.layout[pitch.low + placed.transpose], high = g.layout[pitch.high + placed.transpose];
    const left = low.x * g.width, right = (high.x + high.width) * g.width;
    const bottom = g.present - placed.delayBeats * g.pixelsPerBeat;
    const top = bottom - score.analysis.durationBeats * g.pixelsPerBeat;
    context.strokeStyle = '#b4ffe3'; context.lineWidth = 1; context.setLineDash([5, 4]);
    context.strokeRect(left, top, right - left, bottom - top); context.setLineDash([]);
    context.fillStyle = '#96f4cc'; context.globalAlpha = .65;
    const stride = Math.max(1, Math.ceil(notes.length / 4096));
    for (let index = 0; index < notes.length; index += stride) {
      const note = notes[index], key = pixels[note.note + placed.transpose];
      if (!key) continue;
      const y = bottom - (note.beat + note.duration) * g.pixelsPerBeat, end = bottom - note.beat * g.pixelsPerBeat;
      if (end <= 0 || y >= g.present) continue;
      context.fillRect(key.left / scale, Math.max(0, y), key.noteWidth / scale, Math.max(1, Math.min(g.present, end) - Math.max(0, y)));
    }
    context.globalAlpha = 1;
  }
  function railPosition(pitch, g) {
    const key = g.layout[pitch];
    return { x: (key.x + key.width / 2) * g.width, width: key.width * g.width, black: key.black };
  }
  function railCursorPosition(g) {
    const { x, width, black } = railPosition(railCursor, g);
    railCursorMark.style.left = `${x}px`; railCursorMark.style.setProperty('--rail-key-width', `${width}px`);
    railCursorMark.dataset.black = String(black);
    railSurface.dataset.pitch = String(railCursor);
    railSurface.setAttribute('aria-label', `Note rail · ${noteName(railCursor)}. Left and right choose pitch; press and hold Enter or Space for a repeating note, press twice to sustain; Delete removes the selected note.`);
  }
  function updateCrossingHint(crossing = liveSources().find(source => source.source === 'crossing')) {
    if (!crossingSurface) return;
    const active = Boolean(crossing?.active && crossing.settings?.loop);
    const period = crossingGesture && !active
      ? blechCrossingPeriod(performance.now() - crossingGesture.startedAt, crossingPeriod)
      : crossing?.settings?.periodBeats ?? crossingPeriod;
    const block = active ? crossing.settings?.block ?? 0 : combLastBlock;
    const interval = `${periodLabel(period)} ${period <= 1 ? 'beat' : 'beats'}`;
    const label = active
      ? `Stop both rails: ${combName(block)} every ${interval}`
      : `Loop ${combName(block)} every ${interval}; hold to choose a subdivision; tap again to stop`;
    crossingSurface.setAttribute('aria-pressed', String(active));
    crossingSurface.dataset.playing = String(Boolean(crossing?.playing));
    crossingSurface.dataset.period = String(period);
    crossingSurface.dataset.block = String(block);
    crossingSurface.querySelector('.blech-crossing-rate').textContent = periodLabel(period);
    if (crossingSurface.getAttribute('aria-label') !== label) crossingSurface.setAttribute('aria-label', label);
    crossingSurface.title = label;
  }
  function refreshRails(current, force = false) {
    const alignment = getView().alignment === 'equal' ? 'equal' : 'piano';
    const railLayers = current.filter(source => source.source === 'rail');
    const crossing = current.find(source => source.source === 'crossing');
    const byId = new Map(current.map(source => [source.id, source]));
    const activeComb = combCreated.filter(row => byId.has(row.id));
    if (!combGesture) {
      // Once a one-shot row has finished, its chosen pitch blocks still
      // belong to the corner's next loop until the user changes them.
      const block = activeComb.at(-1)?.block ?? combLastBlock;
      if (combLastBlock !== block) { combLastBlock = block; combLabel(block); }
    }
    updateCrossingHint(crossing);
    const signature = [viewport.clientWidth, viewport.clientHeight, getTempo(), alignment,
      `${crossing?.id ?? ''}:${crossing?.settings?.loop}:${crossing?.settings?.periodBeats}:${crossing?.settings?.block}:${crossing?.playing}`,
      ...railLayers.map(source => `${source.id}:${source.score?.analysis?.notes?.[0]?.note}:${source.settings?.periodBeats}:${source.settings?.hold}:${source.playing}:${source.paused}`),
      ...activeComb.map(row => `${row.id}:${byId.get(row.id).settings?.delayBeats}:${byId.get(row.id).playing}`)].join('|');
    if (!force && signature === railSignature) return;
    railSignature = signature;
    const g = geometry();
    if (!g.width || !g.height) return;
    noteRail.dataset.railLayout = alignment;
    const scale = Math.min(globalThis.devicePixelRatio || 1, 2);
    const gridWidth = Math.max(1, Math.round(g.width * scale)), gridHeight = Math.max(1, Math.round(noteRail.clientHeight * scale));
    if (railGrid.width !== gridWidth || railGrid.height !== gridHeight || railGridAlignment !== alignment) {
      railGrid.width = gridWidth; railGrid.height = gridHeight; railGridAlignment = alignment;
      const cells = blackMidiPixelLayout(g.layout, gridWidth);
      for (let pitch = 0; pitch < cells.length; pitch++) {
        const cell = cells[pitch];
        railGridContext.fillStyle = g.layout[pitch].black ? '#273431' : '#4a5852';
        railGridContext.fillRect(cell.left, 0, cell.noteWidth, gridHeight);
        // A one-pixel cell must show its pitch color, not just a divider.
        if (cell.noteWidth >= 3) {
          railGridContext.fillStyle = '#82918b';
          railGridContext.fillRect(cell.left, 0, 1, gridHeight);
        }
      }
    }
    railCursorPosition(g);
    const old = new Map([...railMarkers.children].map(marker => [marker.dataset.railId, marker]));
    for (const source of railLayers) {
      const pitch = source.score?.analysis?.notes?.[0]?.note;
      if (!Number.isInteger(pitch) || pitch < 0 || pitch > 127) continue;
      const { x, width, black } = railPosition(pitch, g), held = Boolean(source.settings?.hold);
      const marker = old.get(source.id) ?? document.createElement('button');
      old.delete(source.id);
      marker.type = 'button'; marker.className = 'blech-note-rail-marker';
      marker.dataset.railId = source.id; marker.dataset.pitch = String(pitch);
      marker.dataset.black = String(black); marker.dataset.held = String(held);
      marker.dataset.playing = String(source.playing);
      marker.style.left = `${x}px`; marker.style.setProperty('--rail-key-width', `${width}px`);
      marker.setAttribute('aria-label', `Remove ${held ? 'held' : 'repeating'} ${noteName(pitch)} rail note`);
      marker.title = `${noteName(pitch)} · ${held ? 'sustain' : `every ${source.settings?.periodBeats ?? .25} beat(s)`} · tap to remove`;
      if (!marker.isConnected) railMarkers.append(marker);
    }
    for (const marker of old.values()) marker.remove();
    if (combSurface) {
      combCreated = activeComb;
      const marks = combSurface.querySelector('.blech-comb-markers');
      marks.replaceChildren(...activeComb.map(row => {
        const mark = document.createElement('span'); mark.className = 'blech-comb-marker';
        mark.dataset.playing = String(byId.get(row.id).playing);
        mark.style.top = `${(railColumn ? noteRail.offsetHeight : 0)
          + clamp(g.present - (byId.get(row.id).settings?.delayBeats ?? 0) * g.pixelsPerBeat, 4, Math.max(4, g.present - 4))}px`;
        return mark;
      }));
    }
  }
  function render(force = false) {
    if (disposed) return;
    const current = sources();
    refreshRails(liveSources(), force);
    // The main transport reflects frequently. With no frame or gesture there
    // is nothing to paint; do not allocate a full-stage canvas on every tick.
    if (!force && mode === 'math' && mathDraft && !mathDirty && !combGesture) return;
    // Eraser edits a selected layer only, not unboxed live notes.
    modeButtons[1].disabled = !current.length;
    if (!force && !selectedId && !shapeDraft && !combGesture && !mathDraft && !previewHasInk) return;
    const g = geometry(); if (!g.width || !g.height) return;
    const coarse = globalThis.matchMedia?.('(pointer: coarse)').matches, compact = g.width < 306, targetSize = coarse ? 48 : 28, valveHeight = coarse ? 54 : 46;
    // On a shallow touch stage, removal remains in Layers; the four source
    // actions that matter while shaping a frame fit beside it in one row.
    const shallowTouchStage = coarse && g.present < 112, compactValves = compact || shallowTouchStage;
    const cornerOnlyLoop = current.some(source => source.id === selectedId && ['comb', 'crossing'].includes(source.source));
    const valveCount = (mode === 'select' || compactValves ? 5 : 6) - Number(cornerOnlyLoop);
    const valveWidth = valveCount * (coarse ? 48 : 40) + (valveCount - 1) * 4 + 6;
    overlay.style.height = `${Math.max(0, g.present - 2)}px`; canvas.style.height = `${g.height}px`;
    if (combSurface) combSurface.style.height = `${Math.max(48, g.height + (railColumn ? noteRail.offsetHeight : 0))}px`;
    overlay.dataset.mode = mode; overlay.dataset.geometry = getDrawingGesture(mode)?.tool ?? 'pencil';
    surface.style.height = `${Math.max(0, g.present - 2)}px`; surface.tabIndex = mode === 'select' ? -1 : 0;
    surface.setAttribute('aria-label', mode === 'draw' && getDrawingGesture(mode)?.tool === 'line'
      ? 'Click connected line anchors; double-click to drop the whole path. Arrow keys position, Enter adds anchors, Space finishes, Escape cancels.'
      : mode === 'math' ? 'Free Math shape. Move to choose a pitch and time; tap or press Enter to place once. Arrows move the preview; Escape cancels.'
      : 'MIDI flow canvas. Arrow keys position; hold Enter to draw, erase or stamp; Escape returns to layer editing.');
    for (const button of modeButtons) button.setAttribute('aria-pressed', String(button.dataset.spigotMode === mode));
    const ids = new Set(current.map(source => source.id));
    if (selectedId && !ids.has(selectedId)) { selectedId = null; onSelectionChange?.(null); }
    const dpr = Math.min(devicePixelRatio || 1, 2, Math.sqrt(1_000_000 / (g.width * g.height)));
    const width = Math.round(g.width * dpr), height = Math.round(g.height * dpr);
    if (canvas.width !== width || canvas.height !== height) { canvas.width = width; canvas.height = height; }
    else context.clearRect(0, 0, width, height);
    context.setTransform(dpr, 0, 0, dpr, 0, 0);
    const inkPixels = blackMidiPixelLayout(g.layout, width);
    const source = selected(); selection.hidden = !source;
    previewHasInk = Boolean(source || combGesture || shapeDraft || mathDraft);
    selection.classList.toggle('is-compact', compactValves);
    const frameControls = Boolean(source && !brush && !shapeDraft && !combGesture && (mode === 'select'
      || (mode === 'draw' || mode === 'stamp') && performance.now() >= suppressValvesUntil));
    overlay.dataset.frameControls = String(frameControls);
    for (const control of selection.querySelectorAll('button')) control.tabIndex = mode === 'select' || frameControls && control.closest('.blech-spigot-valves') ? 0 : -1;
    if (!source) {
      drawGeometryPreview(g, inkPixels, dpr);
      // During a Comb hold, show only its selected pitch blocks, not the
      // unrelated Free Math preview beneath them. Restore Math on release.
      if (!combGesture) drawMathPreview(g, inkPixels, dpr);
      drawCombPreview(g, inkPixels, dpr);
      mathDirty = false;
      return;
    }
    selection.dataset.spigotId = source.id;
    const settings = source.settings ?? source, d = spigotDimensions(source);
    const state = source.paused ? 'Paused' : source.playing ? settings.hold ? 'Held' : settings.loop ? 'Looping' : 'Playing' : 'Stopped';
    label.textContent = `${source.name || 'Layer'} · ${state}`;
    move.setAttribute('aria-label', `Move ${source.name || 'layer'}; arrows change pitch and delay`);
    const low = g.layout[Math.round(clamp(d.low, 0, 127))], high = g.layout[Math.round(clamp(d.high, 0, 127))];
    const left = clamp(low.x * g.width, 2, Math.max(2, g.width - 24)), right = clamp((high.x + high.width) * g.width, left + 24, g.width - 2);
    // Free Draw stores its initial vertical offset inside the one-shot MIDI.
    // The editing frame should enclose the notes, not that silent prefix.
    const firstNoteBeat = source.freeDraw ? source.score?.analysis?.notes?.[0]?.beat ?? 0 : 0;
    const bottom = clamp(g.present - (d.delayBeats + firstNoteBeat) * g.pixelsPerBeat, 28, g.present - 2);
    const top = clamp(g.present - (d.delayBeats + d.heightBeats) * g.pixelsPerBeat, 2, bottom - 24);
    const gripSize = 28; // Matches the hit area in blech-midi-spigots.css.
    const railClearance = railColumn ? 2 : noteRail.offsetHeight + 2;
    const shortFrame = bottom - top < gripSize * 2, narrowFrame = right - left < gripSize * 2;
    const tinyFrame = shortFrame && right - left < gripSize * 6;
    const minMove = coarse ? 48 : 28, moveWidth = tinyFrame ? Math.max(right - left, minMove) : right - left;
    const moveHeight = tinyFrame ? minMove : bottom - top;
    const moveLeft = tinyFrame ? clamp((left + right - moveWidth) / 2, 0, g.width - moveWidth) : left;
    const moveTop = tinyFrame ? clamp((top + bottom - moveHeight) / 2, 0, g.present - moveHeight - 2) : top;
    // For very small phrases, the frame is the move target; the gear retains
    // exact resizing without eight overlapping grips stealing its gesture.
    Object.assign(move.style, { left: `${moveLeft}px`, top: `${moveTop}px`, width: `${moveWidth}px`, height: `${moveHeight}px`, minHeight: '0' });
    Object.assign(label.style, { left: `${left + 6}px`, top: `${top + 5}px`, maxWidth: `${Math.max(40, right - left - 12)}px` });
    // Do not expose a clipped grip at either stage edge. On a shallow touch
    // stage, reserve extra room on the right for the fullscreen control.
    // The centered top/bottom grips and local gear still resize wide frames.
    const clippedLeft = left < gripSize / 2 + 2;
    const clippedRight = right > g.width - gripSize / 2 - (shallowTouchStage ? 48 : 2);
    // A tap at zero delay ends on the keyboard seam. Keep the whole bottom
    // handle inside the future overlay so its hit center is not clipped.
    const bottomGrip = Math.min(bottom, Math.max(gripSize / 2 + 2, g.present - gripSize / 2 - 4));
    const topGrip = Math.max(top, railClearance + gripSize / 2);
    // A full-width frame can become only a few pixels tall in landscape.
    // Separate its top/bottom targets across the frame rather than stacking
    // them over one another or the rotate handle.
    const spreadMiddleGrips = bottomGrip - topGrip < gripSize + 4 && right - left >= gripSize * 6;
    for (const grip of overlay.querySelectorAll('[data-spigot-resize]')) {
      const edge = grip.dataset.spigotResize;
      const side = edge === 'left' || edge === 'right', middle = edge === 'top' || edge === 'bottom';
      // A short frame cannot fit three vertically adjacent touch targets.
      // Its corners still resize either axis; the local gear offers exact edits.
      grip.hidden = tinyFrame || side && shortFrame || middle && narrowFrame
        || clippedLeft && edge.includes('left') || clippedRight && edge.includes('right');
      if (grip.hidden) grip.tabIndex = -1;
      const centerX = (left + right) / 2;
      grip.style.left = `${edge.includes('left') ? left : edge.includes('right') ? right
        : spreadMiddleGrips && edge === 'top' ? centerX - gripSize - 4
          : spreadMiddleGrips && edge === 'bottom' ? centerX + gripSize + 4 : centerX}px`;
      // Standalone canvas fixtures still overlay the rail; the main stage has
      // its own row, so both top and bottom handles use the playable plane.
      grip.style.top = `${edge.includes('top') ? topGrip : edge.includes('bottom') ? bottomGrip : (top + bottom) / 2}px`;
    }
    const rotateOffset = gripSize / 2 + targetSize / 2 + 4;
    let rotateX = (left + right) / 2, rotateY = top - rotateOffset;
    const rotateOnSide = rotateY < railClearance + targetSize / 2;
    if (rotateOnSide) {
      if (right + rotateOffset + targetSize / 2 <= g.width) rotateX = right + rotateOffset;
      else if (left - rotateOffset - targetSize / 2 >= 0) rotateX = left - rotateOffset;
      else rotateX = left + (right - left) * .75;
      rotateY = Math.max(top, railClearance + targetSize / 2);
    }
    const maxRotateY = Math.max(targetSize / 2, g.present - targetSize / 2 - 2);
    Object.assign($('.blech-spigot-rotate').style, {
      left: `${clamp(rotateX, targetSize / 2, g.width - targetSize / 2)}px`,
      top: `${clamp(rotateY, Math.min(railClearance + targetSize / 2, maxRotateY), maxRotateY)}px`,
    });
    // Keep the little source transport clear of resize grips. On short stages
    // there may be no room below the frame: use a free side instead.
    // On a shallow stage the rotation target moves beside the frame. Leave
    // its *whole* touch target free rather than placing Play across its center.
    // Else the side gap only needs to clear the grips.
    const valveSideGap = rotateOnSide ? rotateOffset + targetSize / 2 + 8 : gripSize / 2 + 24;
    const valveBelow = bottom + 18 + valveHeight <= g.present - 2;
    const valveLeft = left - valveWidth - valveSideGap, valveRight = right + valveSideGap;
    const side = valveLeft >= 0 ? valveLeft : valveRight + valveWidth <= g.width ? valveRight : null;
    const valvesLeft = valveBelow ? clamp(left, 0, Math.max(0, g.width - valveWidth)) : side ?? 0;
    const preferredValvesTop = valveBelow ? bottom + 18 : side !== null
      ? clamp(bottom - valveHeight / 2, 0, Math.max(0, g.present - valveHeight - 2))
      : clamp(top - rotateOffset - targetSize / 2 - 24 - valveHeight, 0, Math.max(0, g.present - valveHeight - 2));
    const maxValvesTop = Math.max(0, g.present - valveHeight - 2);
    const valvesTop = clamp(preferredValvesTop, Math.min(railClearance, maxValvesTop), maxValvesTop);
    Object.assign($('.blech-spigot-valves').style, { left: `${valvesLeft}px`, top: `${valvesTop}px` });
    // A shallow stage may not fit the whole transport beside the frame.
    // Never leave a visible grip whose center the transport has to cover;
    // its adjacent edge grips and the exact settings still resize the frame.
    if (frameControls) for (const grip of selection.querySelectorAll('[data-spigot-resize]:not([hidden])')) {
      const x = parseFloat(grip.style.left), y = parseFloat(grip.style.top);
      if (x >= valvesLeft && x <= valvesLeft + valveWidth && y >= valvesTop && y <= valvesTop + valveHeight) {
        grip.hidden = true; grip.tabIndex = -1;
      }
    }
    const play = $('[data-spigot-play]'); play.textContent = source.paused || !source.playing ? '▶' : 'Ⅱ'; play.setAttribute('aria-label', source.paused || !source.playing ? 'Play source' : 'Pause source');
    const loop = $('[data-spigot-loop]');
    loop.hidden = cornerOnlyLoop; loop.disabled = cornerOnlyLoop;
    loop.setAttribute('aria-pressed', String(Boolean(settings.loop)));
    const notes = source.score?.analysis?.notes ?? [], stride = Math.max(1, Math.ceil(notes.length / 4096)); context.fillStyle = '#ff8752'; context.globalAlpha = .55;
    for (let i = 0; i < notes.length; i += stride) {
      const note = notes[i], key = inkPixels[note.note]; if (!key) continue;
      const y = g.present - (d.delayBeats + note.beat + note.duration) * g.pixelsPerBeat, end = g.present - (d.delayBeats + note.beat) * g.pixelsPerBeat;
      if (end < 0 || y > g.present) continue;
      context.fillRect(key.left / dpr, Math.max(0, y), key.noteWidth / dpr, Math.max(1, Math.min(g.present, end) - Math.max(0, y)));
    }
    context.globalAlpha = 1;
    if (source.active && !source.lastSample?.pending) {
      const phase = clamp((source.lastSample?.positionBeats ?? 0) / Math.max(.001, d.heightBeats), 0, 1);
      const y = clamp(g.present - (d.delayBeats + phase * d.heightBeats) * g.pixelsPerBeat, top, bottom);
      context.strokeStyle = '#ffe0cf'; context.lineWidth = 1;
      context.beginPath(); context.moveTo(left, y); context.lineTo(right, y); context.stroke();
    }
    drawCombPreview(g, inkPixels, dpr);
    drawGeometryPreview(g, inkPixels, dpr);
  }
  function drawGeometryPreview(g, pixels, scale) {
    if (!shapeDraft) return;
    if (!shapeDraft.notes) {
      try { shapeDraft.notes = blechGeometryNotes(shapeDraft.tool,
        shapeDraft.tool === 'line' ? [...shapeDraft.points, shapeDraft.end] : shapeDraft.start,
        shapeDraft.end, shapeDraft.brush, shapeDraft.fill); }
      catch (error) { shapeDraft.notes = []; status(error.message); }
    }
    context.fillStyle = '#b4ffe3'; context.globalAlpha = .8;
    for (const note of shapeDraft.notes) {
      const key = pixels[note.note]; if (!key) continue;
      const y = g.present - (note.beat + note.duration) * g.pixelsPerBeat;
      const end = g.present - note.beat * g.pixelsPerBeat;
      context.fillRect(key.left / scale, y, key.noteWidth / scale, Math.max(1, end - y));
    }
    context.globalAlpha = 1;
    if (shapeDraft.tool === 'line') {
      const screen = point => ({ x: (g.layout[point.pitch].x + g.layout[point.pitch].width / 2) * g.width,
        y: g.present - point.delayBeats * g.pixelsPerBeat });
      context.strokeStyle = '#96f4cc'; context.fillStyle = '#fff3dc'; context.lineWidth = 1.5;
      context.beginPath();
      for (const [index, point] of shapeDraft.points.entries()) {
        const { x, y } = screen(point);
        if (index) context.lineTo(x, y); else context.moveTo(x, y);
      }
      context.stroke();
      if (shapeDraft.points.length) {
        const from = screen(shapeDraft.points.at(-1)), to = screen(shapeDraft.end);
        context.beginPath(); context.setLineDash([4, 3]); context.moveTo(from.x, from.y);
        context.lineTo(to.x, to.y); context.stroke(); context.setLineDash([]);
      }
      for (const point of shapeDraft.points) {
        const { x, y } = screen(point);
        context.fillRect(x - 3, y - 3, 6, 6);
      }
      return;
    }
    const low = g.layout[Math.min(shapeDraft.start.pitch, shapeDraft.end.pitch)];
    const high = g.layout[Math.max(shapeDraft.start.pitch, shapeDraft.end.pitch)];
    const first = Math.min(shapeDraft.start.delayBeats, shapeDraft.end.delayBeats);
    const last = Math.max(shapeDraft.start.delayBeats, shapeDraft.end.delayBeats);
    context.strokeStyle = '#96f4cc'; context.setLineDash([5, 3]);
    context.strokeRect(low.x * g.width - 5, g.present - last * g.pixelsPerBeat - 5,
      Math.max(24, (high.x + high.width - low.x) * g.width + 10), Math.max(24, (last - first) * g.pixelsPerBeat + 10));
    context.setLineDash([]);
  }
  for (const button of modeButtons) listen(button, 'click', () => setMode(button.dataset.spigotMode));
  listen($('[data-spigot-deselect]'), 'click', () => setSelection(null));
  listen($('[data-spigot-play]'), 'click', () => { act(() => onTogglePlay?.(selectedId)); render(); });
  listen($('[data-spigot-loop]'), 'click', () => {
    const source = selected();
    if (['comb', 'crossing'].includes(source?.source)) return;
    act(() => onToggleLoop?.(selectedId, !(source?.settings?.loop ?? source?.loop))); render();
  });
  listen($('[data-spigot-transform]'), 'click', () => { setMode('select'); move.focus({ preventScroll: true }); });
  listen($('[data-spigot-settings]'), 'click', () => { const id = selectedId; if (id) { setMode('select'); act(() => onOpenSettings?.(id)); } });
  listen($('[data-spigot-remove]'), 'click', () => { const id = selectedId; setSelection(null); act(() => onRemove?.(id)); render(); });
  function pointerPoint(event) {
    const rect = viewport.getBoundingClientRect();
    return spigotPoint(event.clientX - rect.left, event.clientY - rect.top, spigotGeometry(rect.width, rect.height, getTempo(), getView()));
  }
  let combActivationTimer = null, suppressCombActivation = false;
  function combPoint(event, startY) {
    return quarter(clamp((startY - event.clientY) / Math.max(.001, geometry().pixelsPerBeat), 0, 64));
  }
  function beginComb(event = null) {
    if (!combSurface || !onCreateComb || disposed || combGesture || brush || drag) return;
    if (event) {
      event.preventDefault(); combSurface.focus({ preventScroll: true });
      // A tap sounds now, even high up the bar. Drag upward to put the chord
      // further into the future; a steady hold changes its on/off pitch blocks.
      combDelayBeats = 0; combSurface.setPointerCapture(event.pointerId);
    }
    const active = new Set(liveSources().map(source => source.id));
    combCreated = combCreated.filter(row => active.has(row.id));
    combGesture = { pointerId: event?.pointerId ?? null, startedAt: performance.now(), delayBeats: combDelayBeats,
      x: event?.clientX, y: event?.clientY, dragging: false, priorCombId: combCreated.at(-1)?.id ?? null, priorSelectionId: selectedId };
    combPulse = setInterval(render, 100); render();
  }
  function finishComb(cancelled = false) {
    if (!combGesture) return;
    const previous = combGesture; combGesture = null;
    clearInterval(combPulse); combPulse = null;
    if (previous.pointerId !== null && combSurface.hasPointerCapture?.(previous.pointerId)) combSurface.releasePointerCapture(previous.pointerId);
    const block = blechCombBlock(performance.now() - previous.startedAt), notes = blechCombNotes(block);
    combSurface.dataset.holding = 'false';
    if (!cancelled) {
      const result = act(() => onCreateComb?.({ block, notes, delayBeats: previous.delayBeats, name: combName(block) }));
      if (result?.id && liveSources().some(source => source.id === result.id)) {
        combCreated.push({ id: result.id, block });
        if (previous.pointerId !== null && performance.now() - previous.startedAt <= 350 && !previous.dragging) {
          recentCombGestures.push({ id: result.id, x: previous.x, y: previous.y, endedAt: performance.now(),
            priorCombId: previous.priorCombId, priorSelectionId: previous.priorSelectionId });
          recentCombGestures = recentCombGestures.slice(-2);
        } else recentCombGestures = [];
        combLastBlock = block;
        status(`${combName(block)} · ${notes.length} notes · plays once. Only the corner repeats this pattern.`);
      }
    } else recentCombGestures = [];
    combLabel(combLastBlock);
    render(mode === 'math' && Boolean(mathDraft));
  }
  if (combSurface) {
    listen(combSurface, 'pointerdown', event => { if (event.button === 0 && event.isPrimary) beginComb(event); });
    listen(combSurface, 'pointermove', event => {
      if (combGesture?.pointerId !== event.pointerId) return;
      if (Math.abs(event.clientY - combGesture.y) > 6 || combGesture.dragging) {
        combGesture.dragging = true;
        combGesture.delayBeats = combDelayBeats = combPoint(event, combGesture.y);
        render();
      }
    });
    listen(combSurface, 'pointerup', event => { if (combGesture?.pointerId === event.pointerId) finishComb(); });
    for (const type of ['pointercancel', 'lostpointercapture']) listen(combSurface, type, () => finishComb(true));
    listen(combSurface, 'dblclick', event => {
      if (event.button !== 0) return;
      const near = recentCombGestures.filter(gesture => performance.now() - gesture.endedAt <= 650
        && Math.hypot(event.clientX - gesture.x, event.clientY - gesture.y) <= 6);
      if (near.length !== 2) return;
      event.preventDefault();
      // The two fast clicks create provisional rows immediately. Remove both,
      // then only the last existing Comb row; never erase a drawing or file.
      const active = new Set(liveSources().map(source => source.id));
      const target = near[0].priorCombId, remove = [...new Set([...near.map(gesture => gesture.id), target].filter(id => active.has(id)))];
      recentCombGestures = [];
      for (const id of remove) act(() => onRemove?.(id));
      const remaining = new Set(liveSources().map(source => source.id));
      combCreated = combCreated.filter(row => remaining.has(row.id));
      combLastBlock = combCreated.at(-1)?.block ?? 0;
      combLabel(combLastBlock);
      const restore = near[0].priorSelectionId;
      if (selectedId !== restore) setSelection(sources().some(source => source.id === restore) ? restore : null);
      status(target && active.has(target) ? 'Deleted the last Comb row.' : 'Double-click cancelled the new Comb row.');
    });
    listen(combSurface, 'keydown', event => {
      if (['ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) {
        event.preventDefault();
        combDelayBeats = event.key === 'Home' ? 0 : event.key === 'End' ? 64
          : quarter(clamp(combDelayBeats + (event.key === 'ArrowUp' ? 1 : -1) * (event.shiftKey ? 1 : .25), 0, 64));
        if (combGesture?.pointerId === null) combGesture.delayBeats = combDelayBeats;
        status(`Pitch comb · ${combDelayBeats} beats before the keyboard.`);
        render();
      }
      if (['Enter', ' '].includes(event.key)) { event.preventDefault(); if (!event.repeat) beginComb(); }
      if (event.key === 'Escape') { event.preventDefault(); finishComb(true); }
    });
    listen(combSurface, 'keyup', event => {
      if (!['Enter', ' '].includes(event.key)) return;
      event.preventDefault();
      if (combGesture?.pointerId === null) finishComb();
      suppressCombActivation = true; clearTimeout(combActivationTimer);
      combActivationTimer = setTimeout(() => { suppressCombActivation = false; combActivationTimer = null; }, 0);
    });
    // Assistive activation can synthesize a click without key or pointer events.
    listen(combSurface, 'click', event => { if (event.detail === 0 && !suppressCombActivation && !combGesture) { beginComb(); finishComb(); } });
  }
  function toggleCrossing(period) {
    const existing = liveSources().find(source => source.source === 'crossing');
    if (existing) {
      if (act(() => onRemove?.(existing.id)) !== true) { render(true); return; }
      if (selectedId === existing.id) setSelection(null);
      if (existing.active && existing.settings?.loop) {
        status('Both rails stopped.'); render(true); return;
      }
    }
    const block = combLastBlock;
    const result = act(() => onCreateCrossing({ notes: blechCrossingNotes(block, period), block, periodBeats: period }));
    if (result?.id && liveSources().some(source => source.id === result.id))
      status(`Both rails · ${combName(block)} every ${periodLabel(period)} ${period <= 1 ? 'beat' : 'beats'}. Tap the corner again to stop.`);
    render(true);
  }
  function beginCrossing(event = null) {
    if (!crossingSurface || !onCreateCrossing || disposed || crossingGesture) return;
    if (event) {
      event.preventDefault(); crossingSurface.focus({ preventScroll: true });
      crossingSurface.setPointerCapture(event.pointerId);
    }
    crossingGesture = { pointerId: event?.pointerId ?? null, startedAt: performance.now() };
    crossingPulse = setInterval(updateCrossingHint, 100);
    updateCrossingHint();
  }
  function finishCrossing(cancelled = false) {
    if (!crossingGesture) return;
    const gesture = crossingGesture;
    crossingGesture = null;
    clearInterval(crossingPulse); crossingPulse = null;
    if (gesture.pointerId !== null && crossingSurface.hasPointerCapture?.(gesture.pointerId))
      crossingSurface.releasePointerCapture(gesture.pointerId);
    if (!cancelled) {
      const existing = liveSources().find(source => source.source === 'crossing');
      if (!existing?.active || !existing.settings?.loop) {
        crossingPeriod = blechCrossingPeriod(performance.now() - gesture.startedAt, crossingPeriod);
      }
      toggleCrossing(crossingPeriod);
    } else updateCrossingHint();
  }
  if (crossingSurface) {
    listen(crossingSurface, 'pointerdown', event => {
      if (event.button === 0 && event.isPrimary) beginCrossing(event);
    });
    listen(crossingSurface, 'pointerup', event => {
      if (crossingGesture?.pointerId === event.pointerId) finishCrossing();
    });
    for (const type of ['pointercancel', 'lostpointercapture'])
      listen(crossingSurface, type, event => {
        if (crossingGesture?.pointerId === event.pointerId) finishCrossing(true);
      });
    listen(crossingSurface, 'keydown', event => {
      if (['Enter', ' '].includes(event.key)) {
        event.preventDefault(); if (!event.repeat) beginCrossing();
      }
      if (event.key === 'Escape') { event.preventDefault(); finishCrossing(true); }
    });
    listen(crossingSurface, 'keyup', event => {
      if (!['Enter', ' '].includes(event.key)) return;
      event.preventDefault();
      if (crossingGesture?.pointerId === null) finishCrossing();
      suppressCrossingActivation = true; clearTimeout(crossingActivationTimer);
      crossingActivationTimer = setTimeout(() => { suppressCrossingActivation = false; crossingActivationTimer = null; }, 0);
    });
    // Physical clicks finish on pointerup; assistive clicks have no pointer.
    listen(crossingSurface, 'click', event => {
      if (event.detail !== 0 || suppressCrossingActivation || crossingGesture) return;
      beginCrossing(); finishCrossing();
    });
  }
  function railPitch(event) {
    const rect = noteRail.getBoundingClientRect(), x = clamp((event.clientX - rect.left) / rect.width, 0, 1);
    return blackMidiKeyboardPitch(x, .5, getView().alignment === 'equal' ? 'equal' : 'piano');
  }
  const railAtPitch = pitch => liveSources().find(source => source.source === 'rail'
    && source.score?.analysis?.notes?.[0]?.note === pitch)?.id ?? null;
  function updateRailPreview() {
    if (!railGesture) return;
    const g = geometry(), { x, width, black } = railPosition(railGesture.pitch, g);
    const period = blechRailPeriod(performance.now() - railGesture.startedAt);
    railPreview.hidden = false; railPreview.style.left = `${x}px`;
    railPreview.style.setProperty('--rail-key-width', `${width}px`);
    railPreview.dataset.black = String(black);
    const doubleTap = railGesture.id && lastRailTap?.id === railGesture.id
      && performance.now() - lastRailTap.at <= 550;
    railPreview.dataset.held = String(Boolean(doubleTap));
    railPreview.textContent = doubleTap ? '—' : period < 1 ? `1/${1 / period}` : `${period}`;
    noteRail.dataset.period = String(period);
  }
  function beginRail(event = null) {
    if (disposed || !onCreateRail || railGesture) return;
    // On a narrow phone a marker's hit box can cover several key centers.
    // Resolve the pitch from the touch, not from the marker it happened to hit.
    const pitch = event ? railPitch(event) : railCursor, id = railAtPitch(pitch);
    if (event) {
      event.preventDefault();
      noteRail.setPointerCapture(event.pointerId);
      if (!id) railSurface.focus({ preventScroll: true });
    }
    railCursor = pitch; railCursorPosition(geometry());
    railGesture = { pointerId: event?.pointerId ?? null, id, pitch, startedAt: performance.now() };
    updateRailPreview();
    railPulse = setInterval(updateRailPreview, 80); // Visual feedback only; audio uses the MIDI clock.
  }
  function removeRail(id) {
    if (!liveSources().some(source => source.id === id && source.source === 'rail')) return false;
    return act(() => onRemove?.(id)) === true;
  }
  function placeRail(pitch, periodBeats, held) {
    const result = act(() => onCreateRail?.({ pitch, periodBeats, held }));
    return result?.id && liveSources().some(source => source.id === result.id) ? result.id : null;
  }
  function finishRail(cancelled = false) {
    if (!railGesture) return;
    const gesture = railGesture; railGesture = null;
    clearInterval(railPulse); railPulse = null; railPreview.hidden = true;
    if (gesture.pointerId !== null && noteRail.hasPointerCapture?.(gesture.pointerId))
      noteRail.releasePointerCapture(gesture.pointerId);
    if (cancelled) { lastRailTap = null; return; }
    const now = performance.now(), pitch = gesture.pitch;
    const prior = lastRailTap?.pitch === pitch && now - lastRailTap.at <= 550
      && liveSources().some(source => source.id === lastRailTap.id) ? lastRailTap : null;
    if (gesture.id && gesture.id !== prior?.id) {
      if (removeRail(gesture.id)) railStatus.value = `${noteName(pitch)} removed.`;
      lastRailTap = null;
    } else if (prior) {
      // The first tap plays immediately. A second tap at its square replaces
      // that provisional pulse with one held voice, not a second loop.
      if (removeRail(prior.id)) {
        const heldId = placeRail(pitch, 1, true);
        if (heldId) railStatus.value = `${noteName(pitch)} sustained. Tap its square to remove it.`;
      }
      lastRailTap = null;
    } else {
      const period = blechRailPeriod(now - gesture.startedAt);
      const id = placeRail(pitch, period, false);
      if (id) {
        railStatus.value = `${noteName(pitch)} repeating every ${period} beat${period === 1 ? '' : 's'}. Tap its square to remove it.`;
        lastRailTap = { id, pitch, at: now };
      } else lastRailTap = null;
    }
    refreshRails(liveSources());
  }
  listen(noteRail, 'pointerdown', event => {
    if (event.button === 0 && event.isPrimary) beginRail(event);
  });
  listen(noteRail, 'pointermove', event => {
    if (railGesture?.pointerId !== event.pointerId) return;
    const pitch = railPitch(event);
    if (pitch !== railGesture.pitch) {
      railGesture.pitch = railCursor = pitch;
      railGesture.id = railAtPitch(pitch);
      railCursorPosition(geometry()); updateRailPreview();
    }
  });
  listen(noteRail, 'pointerup', event => {
    if (railGesture?.pointerId === event.pointerId) finishRail();
  });
  for (const type of ['pointercancel', 'lostpointercapture'])
    listen(noteRail, type, event => { if (railGesture?.pointerId === event.pointerId) finishRail(true); });
  listen(noteRail, 'keydown', event => {
    if (event.target !== railSurface || event.altKey || event.ctrlKey || event.metaKey) return;
    const step = event.shiftKey ? 12 : 1;
    const directions = { ArrowLeft: -step, ArrowRight: step, ArrowDown: -step, ArrowUp: step };
    if (Object.hasOwn(directions, event.key) || ['Home', 'End'].includes(event.key)) {
      event.preventDefault();
      railCursor = event.key === 'Home' ? 0 : event.key === 'End' ? 127 : Math.round(clamp(railCursor + directions[event.key], 0, 127));
      if (railGesture) railGesture.pitch = railCursor;
      railCursorPosition(geometry()); updateRailPreview();
      railStatus.value = noteName(railCursor);
    }
    if (['Delete', 'Backspace'].includes(event.key)) {
      event.preventDefault();
      const note = liveSources().find(source => source.source === 'rail' && source.score?.analysis?.notes?.[0]?.note === railCursor);
      if (note && removeRail(note.id)) { railStatus.value = `${noteName(railCursor)} removed.`; lastRailTap = null; refreshRails(liveSources()); }
    }
    if (['Enter', ' '].includes(event.key)) { event.preventDefault(); if (!event.repeat) beginRail(); }
    if (event.key === 'Escape' && railGesture) { event.preventDefault(); finishRail(true); }
  });
  listen(noteRail, 'keyup', event => {
    if (event.target !== railSurface || !['Enter', ' '].includes(event.key)) return;
    event.preventDefault();
    if (railGesture?.pointerId === null) finishRail();
    suppressRailActivation = true;
    setTimeout(() => { suppressRailActivation = false; }, 0);
  });
  // Keyboard Enter/Space have their own down/up duration; screen readers may
  // only dispatch a synthetic click. Never duplicate a physical pointer tap.
  listen(noteRail, 'click', event => {
    if (event.detail !== 0 || suppressRailActivation || railGesture) return;
    const marker = event.target.closest?.('[data-rail-id]');
    if (marker) {
      if (removeRail(marker.dataset.railId)) {
        railStatus.value = `${noteName(Number(marker.dataset.pitch))} removed.`;
        lastRailTap = null; refreshRails(liveSources()); railSurface.focus({ preventScroll: true });
      }
    } else if (event.target === railSurface) { beginRail(); finishRail(); }
  });
  function beginBrush(point, pointerId = null, event = null) {
    if (brush || combGesture || mode === 'select' || stampBusy) return;
    if (mode === 'erase' && !selectedId) { status('Select a layer in Layers to erase its notes.', true); return; }
    const prepared = getPreparedScore();
    if (mode === 'stamp' && !prepared?.score?.buffer) { status('Choose a stamp from its corner menu first.', true); return; }
    const handle = act(() => onBrushStart?.({ mode, sourceId: selectedId, ...point, prepared }));
    if (handle == null || handle === false) return;
    brush = { handle, pointerId, point, mode, startedAt: performance.now(), x: event?.clientX, y: event?.clientY,
      lastX: event?.clientX, lastY: event?.clientY, moved: 0 }; cursor = point;
    clearTimeout(revealTimer); revealTimer = null; suppressValvesUntil = Infinity;
    // Free gestures never raise a floating frame over the next canvas click.
    updateDrawingStatus();
    if (mode !== 'erase') pulse = setInterval(() => { if (brush) act(() => onBrushMove?.(brush.handle, brush.point)); }, 33);
  }
  function beginGeometryDraft(point, pointerId = null) {
    const { tool, fill } = getDrawingGesture(mode);
    if (shapeDraft?.tool === 'line' && tool === 'line' && shapeDraft.pointerId === null) {
      shapeDraft.pointerId = pointerId; moveGeometryDraft(point); return;
    }
    if (shapeDraft || brush || combGesture || mode !== 'draw') return;
    if (!['line', 'rectangle', 'ellipse', 'triangle'].includes(tool)) return;
    shapeDraft = { pointerId, mode, tool, fill, brush: { ...getBrush() }, start: point, end: point,
      prepared: getPreparedScore(), notes: null, points: tool === 'line' ? [] : null, lastTap: null };
    cursor = point; render();
  }
  function moveGeometryDraft(point) {
    if (!shapeDraft) return;
    if (point.pitch === shapeDraft.end.pitch && point.delayBeats === shapeDraft.end.delayBeats) return;
    shapeDraft.end = point; shapeDraft.notes = null; cursor = point;
    // Paint at display rate, not at the audio clock or every coalesced pointer
    // sample. Only the final position is rasterized when a frame is available.
    if (shapeFrame === null) shapeFrame = requestAnimationFrame(() => { shapeFrame = null; render(); });
  }
  function finishGeometryDraft(cancelled = false) {
    if (!shapeDraft) return;
    const previous = shapeDraft; shapeDraft = null;
    if (shapeFrame !== null) { cancelAnimationFrame(shapeFrame); shapeFrame = null; }
    if (previous.pointerId !== null && surface.hasPointerCapture?.(previous.pointerId)) surface.releasePointerCapture(previous.pointerId);
    if (!cancelled && (previous.tool !== 'line' || previous.points.length >= 2)) act(() => onGeometryDraft?.(previous));
    render();
  }
  function placeLineAnchor(point, event = null) {
    if (shapeDraft?.tool !== 'line') return;
    const draft = shapeDraft, previous = draft.points.at(-1), now = performance.now();
    if ((!previous || previous.pitch !== point.pitch || previous.delayBeats !== point.delayBeats)
      && draft.points.length < MAX_LINE_ANCHORS) draft.points.push(point);
    draft.end = point; draft.notes = null;
    // Browsers vary in whether touch double taps dispatch a native dblclick.
    const twice = event?.pointerType === 'touch' && draft.lastTap && now - draft.lastTap.at <= 550
      && Math.hypot(event.clientX - draft.lastTap.x, event.clientY - draft.lastTap.y) <= 12;
    draft.lastTap = event ? { x: event.clientX, y: event.clientY, at: now } : null;
    const pointerId = draft.pointerId; draft.pointerId = null;
    if (pointerId !== null && surface.hasPointerCapture?.(pointerId)) surface.releasePointerCapture(pointerId);
    if (twice && draft.points.length >= 2) finishGeometryDraft();
    else {
      status(draft.points.length >= MAX_LINE_ANCHORS
        ? '64 anchors reached. Double-click the last anchor or press Space to drop.'
        : `${draft.points.length} line anchor${draft.points.length === 1 ? '' : 's'} · double-click to drop · Escape to cancel.`);
      render();
    }
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
    act(() => onBrushEnd?.(previous.handle, { cancelled }));
    clearTimeout(revealTimer); revealTimer = null;
    const waitForDoubleClick = !cancelled && previous.mode === 'draw' && recentDrawGestures.at(-1)?.id === previous.handle;
    suppressValvesUntil = performance.now() + (waitForDoubleClick ? 650 : 0);
    if (waitForDoubleClick) revealTimer = setTimeout(() => { revealTimer = null; render(); }, 655);
    render();
  }
  function moveMathPointer(point) {
    if (mode !== 'math' || !mathDraft) return;
    if (cursor.pitch === point.pitch && cursor.delayBeats === point.delayBeats) return;
    cursor = point; mathDirty = true;
    if (mathFrame === null) mathFrame = requestAnimationFrame(() => { mathFrame = null; render(); });
  }
  function placeMath() {
    if (mode !== 'math' || !mathDraft) return;
    const placed = freeMathPlacement(mathDraft.score, mathDraft.settings, cursor, geometry());
    const sent = act(() => onCreateMath?.(mathDraft.score, placed));
    if (sent) status(`${mathDraft.settings.name} placed once. Tap again to place another, or choose a new shape.`);
    render();
  }
  listen(surface, 'pointerdown', event => {
    if (event.button !== 0 || !event.isPrimary) return;
    event.preventDefault(); surface.focus({ preventScroll: true }); surface.setPointerCapture(event.pointerId);
    if (mode === 'math') { mathPointerId = event.pointerId; moveMathPointer(pointerPoint(event)); return; }
    const point = pointerPoint(event), tool = getDrawingGesture(mode)?.tool;
    if (mode === 'draw' && tool !== 'pencil') beginGeometryDraft(point, event.pointerId);
    else beginBrush(point, event.pointerId, event);
  });
  function moveBrushPointer(event) {
    if (!brush || brush.pointerId !== event.pointerId) return;
    const coalesced = brush.mode === 'draw' ? event.getCoalescedEvents?.() : null;
    // Encode the entire gesture once per pointermove, rather than reparsing a
    // growing MIDI score for each sample. Retain the first and recent corners
    // even on devices that batch an unusually long pointer history.
    const samples = coalesced?.length > 128 ? [coalesced[0], ...coalesced.slice(-127)] : coalesced?.length ? coalesced : [event];
    if (samples.at(-1).clientX !== event.clientX || samples.at(-1).clientY !== event.clientY) samples.push(event);
    const rect = viewport.getBoundingClientRect(), g = spigotGeometry(rect.width, rect.height, getTempo(), getView()), path = [];
    for (const sample of samples) {
      brush.moved = Math.max(brush.moved, Math.hypot(sample.clientX - brush.x, sample.clientY - brush.y));
      const point = spigotPoint(sample.clientX - rect.left, sample.clientY - rect.top, g);
      const previous = path.at(-1);
      if (previous?.pitch !== point.pitch || previous?.delayBeats !== point.delayBeats) path.push({
        ...point, elapsedMilliseconds: Number.isFinite(sample.timeStamp) ? Math.max(0, sample.timeStamp - brush.startedAt) : undefined,
      });
    }
    brush.point = { pitch: path.at(-1).pitch, delayBeats: path.at(-1).delayBeats };
    brush.lastX = event.clientX; brush.lastY = event.clientY; cursor = brush.point;
    act(() => onBrushMove?.(brush.handle, brush.mode === 'draw' ? path : brush.point));
  }
  listen(surface, 'pointermove', event => {
    if (mode === 'math') {
      if (mathPointerId === null || mathPointerId === event.pointerId) moveMathPointer(pointerPoint(event));
      return;
    }
    if (shapeDraft && (shapeDraft.pointerId === event.pointerId
      || shapeDraft.tool === 'line' && shapeDraft.pointerId === null)) { moveGeometryDraft(pointerPoint(event)); return; }
    moveBrushPointer(event);
  });
  listen(surface, 'pointerup', event => {
    if (mode === 'math' && mathPointerId === event.pointerId) {
      mathPointerId = null; moveMathPointer(pointerPoint(event)); placeMath(); return;
    }
    if (shapeDraft?.pointerId === event.pointerId) {
      const point = pointerPoint(event); moveGeometryDraft(point);
      if (shapeDraft.tool === 'line') placeLineAnchor(point, event);
      else finishGeometryDraft();
      return;
    }
    if (brush?.pointerId === event.pointerId) {
      if (brush.mode === 'draw' && (brush.lastX !== event.clientX || brush.lastY !== event.clientY)) moveBrushPointer(event);
      endBrush(false);
    }
  });
  listen(surface, 'dblclick', event => {
    if (mode === 'draw' && getDrawingGesture(mode)?.tool === 'line') {
      if (event.button === 0 && shapeDraft?.tool === 'line' && shapeDraft.points.length >= 2) {
        event.preventDefault(); finishGeometryDraft();
      }
      return;
    }
    if (mode !== 'draw' || event.button !== 0 || !onLatch) return;
    const near = recentDrawGestures.filter(gesture => performance.now() - gesture.endedAt <= 650
      && Math.hypot(event.clientX - gesture.x, event.clientY - gesture.y) <= 6);
    if (near.length !== 2) return;
    event.preventDefault(); recentDrawGestures = [];
    const id = act(() => onLatch({ ...pointerPoint(event), prepared: getPreparedScore(), replaceIds: near.map(gesture => gesture.id) }));
    if (id != null && liveSources().some(source => source.id === id)) {
      clearTimeout(revealTimer); revealTimer = null; suppressValvesUntil = 0;
    }
    render();
  });
  for (const name of ['pointercancel', 'lostpointercapture']) listen(surface, name, event => {
    if (mathPointerId === event.pointerId) mathPointerId = null;
    if (shapeDraft?.pointerId === event.pointerId) finishGeometryDraft(true);
    if (brush?.pointerId === event.pointerId) endBrush(true);
  });
  listen(surface, 'keydown', event => {
    const beat = event.shiftKey ? 1 : .25, pitch = event.shiftKey ? 12 : 1;
    const changes = { ArrowLeft: { pitch: cursor.pitch - pitch }, ArrowRight: { pitch: cursor.pitch + pitch }, ArrowUp: { delayBeats: cursor.delayBeats + beat }, ArrowDown: { delayBeats: cursor.delayBeats - beat } };
    if (changes[event.key]) { event.preventDefault(); cursor = { ...cursor, ...changes[event.key] }; cursor.pitch = clamp(cursor.pitch, 0, 127); cursor.delayBeats = clamp(cursor.delayBeats, 0, 64); if (brush) { brush.point = cursor; act(() => onBrushMove?.(brush.handle, cursor)); } moveGeometryDraft(cursor); if (mode === 'math') { mathDirty = true; render(); } status(`Pitch ${cursor.pitch} · delay ${cursor.delayBeats} beats`); }
    if (event.key === 'Enter' && !event.repeat) {
      event.preventDefault();
      const tool = getDrawingGesture(mode)?.tool;
      if (mode === 'math') placeMath();
      else if (mode === 'draw' && tool === 'line') { if (!shapeDraft) beginGeometryDraft(cursor); placeLineAnchor(cursor); }
      else if (mode === 'draw' && tool !== 'pencil') beginGeometryDraft(cursor);
      else beginBrush(cursor);
    }
    if (event.key === ' ' && shapeDraft?.tool === 'line') {
      event.preventDefault(); if (shapeDraft.points.length >= 2) finishGeometryDraft();
      else status('Click another line anchor before finishing.');
    }
    if (event.key === 'Escape') { event.preventDefault(); setMode('select'); }
  });
  listen(surface, 'keyup', event => { if (event.key === 'Enter' && shapeDraft?.tool !== 'line') { finishGeometryDraft(); endBrush(false); } });
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
  const cancelGesture = () => { cancelEdit(); recentDrawGestures = []; recentCombGestures = []; mathPointerId = null; drag = null; selection.dataset.dragging = 'false'; endBrush(true); finishGeometryDraft(true); finishComb(true); finishCrossing(true); finishRail(true); clearTimeout(revealTimer); revealTimer = null; };
  listen(globalThis, 'blur', cancelGesture);
  listen(document, 'visibilitychange', () => { if (document.hidden) cancelGesture(); });
  const resize = new ResizeObserver(() => render(true)); resize.observe(viewport); render(true);
  return { refresh: render, refreshStamps, cancelGesture, setMode, activateStamp,
    openStampPicker() { refreshStamps(); stampMenu.open(); },
    closeStampPicker() { stampMenu.close(); },
    armMath(score, settings) {
      if (!score?.analysis?.notes?.length) return false;
      setMode('math'); mathDraft = { score, settings }; cursor = { pitch: 64, delayBeats: 4 }; mathDirty = true;
      updateDrawingStatus(); render(true); surface.focus({ preventScroll: true });
      return true;
    },
    updateDrawingTool() { updateDrawingStatus(); render(true); },
    select: setSelection, getMode: () => mode, getSelection: () => selectedId,
    dispose() { if (disposed) return; cancelGesture(); if (mathFrame !== null) cancelAnimationFrame(mathFrame); clearTimeout(combActivationTimer); clearTimeout(crossingActivationTimer); stampTicket++; stampMenu?.dispose(); disposed = true; events.abort(); resize.disconnect(); noteRail.remove(); overlay.remove(); combHost?.replaceChildren(); if (ownedHost) controlsHost.remove(); else controlsHost.replaceChildren(); },
  };
}

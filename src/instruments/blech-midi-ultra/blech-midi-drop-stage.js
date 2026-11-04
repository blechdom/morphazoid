import { blackMidiKeyLayout, blackMidiPitchAtX, blackMidiPixelLayout, blackMidiTimeGeometry } from './blech-midi-black-renderer.js';
import { GM_PROGRAM_NAMES, parseMidi } from '../midi-mixer/midi-mixer-model.js';
import { midiStampPitchBounds, transformMidiStamp, rotateMidiStamp } from '../midi-mixer/midi-mixer-score-transform.js';
import { blechStrokeScore, blechBrushImprint, blechGeometryNotes } from './blech-midi-spigot-engine.js';
import { generateUltraTextMidi, ULTRA_TEXT_FONTS, ultraTextGlyphColumns } from './blech-midi-text-fonts.js';

const bound = (value, low, high, fallback = 0) => Math.max(low, Math.min(high, Number.isFinite(Number(value)) ? Number(value) : fallback));
const WORKBOX_NOTE_LIMIT = 4096, WORKBOX_GRID = 1 / 16, PPQ = 480, WORKBOX_VOLUME_MAX = 127;
// The stage's Draw icon is the same path and viewBox as Free Draw in blech-midi-spigots.js.
const DRAW_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M4 16 3 21l5-1L20 8l-4-4L4 16Z"/><path d="m14 6 4 4M4 16l4 4"/></svg>';
const LOOP_STAMP_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><g transform="translate(-1 2) scale(.85)"><path d="M9 5a3 3 0 0 1 6 0c0 1.5-.7 2.3-1.5 3v3l3 4h-9l3-4V8C9.7 7.3 9 6.5 9 5Z"/><rect x="5" y="16" width="14" height="3" rx=".5"/><path d="M4 21h16"/></g><path d="M17 3a5 5 0 1 1-2 9.5M17 3v4m0-4h-4"/></svg>';
const TEXT_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M4 5h16M12 5v15m-4 0h8M4 5v4m16-4v4"/></svg>';
const MATH_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M3 18h18M5 14q4-12 7 0t7-4"/></svg>';

/** A silent box has its own envelope; occupied notes need not touch its edges. */
export function workboxDimensions(box, { widthNotes = null, heightBeats = null, transpose = 0 } = {}) {
  const width = Math.round(bound(widthNotes ?? box.width, 1, 128, box.width));
  const height = bound(heightBeats ?? box.heightBeats, .25, 512, box.heightBeats);
  const originLow = Math.min(box.low, 128 - width);
  const low = bound(originLow + transpose, 0, 128 - width, originLow);
  return { low, high: low + width - 1, width, sourceLow: box.low, sourceWidth: box.width, heightBeats: height };
}

/** Interpolate a brush path inside the box once on release, not per pointer sample. */
export function workboxStrokeNotes(points, box, brush = {}) {
  if (!points?.length) return [];
  const notes = new Map(), high = box.low + box.width - 1, lastBeat = Math.max(0, box.heightBeats - WORKBOX_GRID);
  function add(point) {
    const beat = Math.round(bound(point.beat, 0, lastBeat) / WORKBOX_GRID) * WORKBOX_GRID;
    for (const mark of blechBrushImprint(point.pitch, beat, brush)) {
      if (mark.note < box.low || mark.note > high || mark.beat >= box.heightBeats) continue;
      if (notes.size >= WORKBOX_NOTE_LIMIT) return;
      notes.set(`${mark.note}:${Math.round(mark.beat * PPQ)}`, {
        ...mark, duration: Math.min(mark.duration, box.heightBeats - mark.beat),
      });
    }
  }
  add(points[0]);
  for (let index = 1; index < points.length && notes.size < WORKBOX_NOTE_LIMIT; index++) {
    const from = points[index - 1], to = points[index], steps = Math.min(WORKBOX_NOTE_LIMIT,
      Math.max(1, Math.ceil(Math.abs(to.pitch - from.pitch)), Math.ceil(Math.abs(to.beat - from.beat) / WORKBOX_GRID)));
    for (let step = 1; step <= steps && notes.size < WORKBOX_NOTE_LIMIT; step++)
      add({ pitch: from.pitch + (to.pitch - from.pitch) * step / steps, beat: from.beat + (to.beat - from.beat) * step / steps });
  }
  return [...notes.values()].sort((a, b) => a.beat - b.beat || a.note - b.note);
}

/** Workbox geometry uses Free Draw's shapes and nibs but stays inside the
 * silent box's pitch/time envelope, even after the box was transformed. */
export function workboxGeometryNotes(tool, start, end, box, brush = {}, fill = 'outline') {
  const line = tool === 'line' && Array.isArray(start);
  const notes = blechGeometryNotes(tool, line ? start.map(point => ({ pitch: point.pitch, delayBeats: point.beat }))
    : { pitch: start.pitch, delayBeats: start.beat },
  line ? null : { pitch: end.pitch, delayBeats: end.beat }, brush, fill, box.heightBeats);
  return notes.filter(note => note.note >= box.low && note.note < box.low + box.width && note.beat < box.heightBeats)
    .map(note => ({ ...note, duration: Math.min(note.duration, box.heightBeats - note.beat) }));
}

/** The menu's pitch/beat dimensions are capped by the silent box, not cropped. */
export function workboxStampBounds(score, box, size = {}) {
  const notes = score?.analysis?.notes ?? (score?.buffer ? parseMidi(score.buffer).notes : []);
  if (!notes.length) return null;
  if (notes.length > WORKBOX_NOTE_LIMIT) throw new Error('This stamp has more than 4,096 notes. Choose a smaller pattern.');
  // Math notes may occupy only a narrow part of their graph. Size that
  // picture by its full pitch canvas so a flat curve stays centered.
  const pitchRange = size.pitchRange;
  const low = pitchRange ? pitchRange.low : Math.min(...notes.map(note => note.note));
  const high = pitchRange ? pitchRange.high : Math.max(...notes.map(note => note.note));
  const duration = Math.max(WORKBOX_GRID, score.analysis?.durationBeats ?? Math.max(...notes.map(note => note.beat + note.duration)));
  const scale = bound(size.scale ?? 1, .25, 4, 1);
  const width = Math.min(box.width, Math.round(bound(size.widthNotes ?? (high - low + 1) * scale, 1, 128, high - low + 1)));
  const height = Math.min(box.heightBeats, bound(size.heightBeats ?? duration * scale, WORKBOX_GRID, 512, duration));
  return { notes, low, high, duration, width, height };
}

/** Place the entire stamp at the chosen pitch/time; fit large patterns inside
 * the box rather than losing notes against the edges. Other strokes survive. */
export function workboxStampNotes(score, box, point, size = {}) {
  const bounds = workboxStampBounds(score, box, size);
  if (!bounds) return [];
  const { notes, low, high, duration, width, height } = bounds;
  const left = Math.round(bound(Math.round(point.pitch) - Math.floor(width / 2), box.low, box.low + box.width - width));
  const bottom = bound(Math.round(point.beat / WORKBOX_GRID) * WORKBOX_GRID, 0, box.heightBeats - height);
  return notes.map(note => {
    const pitch = left + Math.round((note.note - low) / Math.max(1, high - low) * (width - 1));
    const beat = Math.round((bottom + note.beat / duration * height) * PPQ) / PPQ;
    return { note: pitch, beat, duration: Math.max(1 / PPQ, Math.min(box.heightBeats - beat, note.duration / duration * height)),
      channel: note.channel ?? 0, velocity: note.velocity };
  });
}

/** Add a prepared pattern's notes to the box without starting its transport.
 * Channel/program/controller editing remains with the final workbox Drop. */
export function workboxShapeNotes(score, box) {
  const notes = score?.analysis?.notes ?? (score?.buffer ? parseMidi(score.buffer).notes : []);
  if (!notes.length) return [];
  if (notes.length > WORKBOX_NOTE_LIMIT) throw new Error('This shape has more than 4,096 notes. Choose a smaller pattern.');
  const low = Math.min(...notes.map(note => note.note)), high = Math.max(...notes.map(note => note.note));
  const beats = Math.max(.25, score.analysis?.durationBeats ?? Math.max(...notes.map(note => note.beat + note.duration)));
  return notes.map(note => {
    const pitch = box.low + Math.round((note.note - low) / Math.max(1, high - low) * (box.width - 1));
    const beat = Math.min(box.heightBeats - 1 / PPQ, Math.round(note.beat / beats * box.heightBeats * PPQ) / PPQ);
    return { note: pitch, beat, duration: Math.max(1 / PPQ, Math.min(box.heightBeats - beat, note.duration / beats * box.heightBeats)),
      channel: note.channel ?? 0, velocity: note.velocity };
  });
}

/** Transform only the workbox's note content; its empty margins stay editable. */
export function workboxRenderedNotes(box, settings = {}) {
  const size = workboxDimensions(box, settings), angle = ((Number(settings.rotationDegrees) || 0) % 360) * Math.PI / 180;
  const cosine = Math.cos(angle), sine = Math.sin(angle), durationScale = size.heightBeats / box.heightBeats;
  return box.notes.map(note => {
    const x = (note.note - box.low) / Math.max(1, box.width - 1) - .5;
    const y = (note.beat + note.duration / 2) / box.heightBeats - .5;
    const pitch = size.low + Math.round(bound(.5 + x * cosine - y * sine, 0, 1, .5) * (size.width - 1));
    const duration = Math.max(1 / PPQ, note.duration * durationScale * Math.max(.125, Math.abs(cosine)));
    const beat = Math.round(bound((.5 + x * sine + y * cosine) * size.heightBeats - duration / 2,
      0, Math.max(0, size.heightBeats - 1 / PPQ), 0) * PPQ) / PPQ;
    return { ...note, note: pitch, beat, duration: Math.max(1 / PPQ, Math.min(duration, size.heightBeats - beat)) };
  }).sort((a, b) => a.beat - b.beat || a.note - b.note);
}

/** Move the complete phrase; never clamp individual notes into a pile at an edge. */
export function constrainDropPosition(notes, { transpose = 0, delayBeats = 2 } = {}) {
  let low = 127, high = 0;
  for (const note of notes) { low = Math.min(low, note.note); high = Math.max(high, note.note); }
  return { transpose: Math.round(bound(transpose, notes.length ? -low : 0, notes.length ? 127 - high : 0)) + 0, delayBeats: Math.round(bound(delayBeats, 0, 64) * 4) / 4 };
}

/** Width is occupied MIDI pitches; height is the full phrase, including its loop boundary. */
export function dropScoreDimensions(score, { widthNotes = null, heightBeats = null, rotationDegrees = 0 } = {}) {
  const analysis = score?.analysis, pitch = midiStampPitchBounds(analysis?.notes ?? [], widthNotes, score?.pitchRange);
  const angle = ((Number(rotationDegrees) || 0) % 360 + 360) % 360;
  const opensTemporalLine = pitch.sourceWidth === 1 && analysis?.notes.at(-1)?.beat !== analysis?.notes[0]?.beat && angle % 180 !== 0;
  if (angle && (widthNotes != null || opensTemporalLine)) {
    pitch.width = widthNotes == null ? 128 : Math.round(bound(widthNotes, 1, 128, pitch.width)); pitch.low = Math.min(pitch.sourceLow, 128 - pitch.width); pitch.high = pitch.low + pitch.width - 1;
  }
  const naturalHeight = analysis?.durationBeats ?? 1;
  const height = heightBeats == null ? naturalHeight : Math.round(bound(heightBeats, .25, 512, naturalHeight) * 4) / 4;
  return { ...pitch, heightBeats: height, timeScale: height / naturalHeight };
}

/** Resize the MIDI itself, retaining all attacks, channels, controllers and metadata. */
export function resizeDropScore(score, settings = {}) {
  if (!score) return null;
  const dimensions = dropScoreDimensions(score, settings);
  const rotation = ((Number(settings.rotationDegrees) || 0) % 360 + 360) % 360;
  if (dimensions.width === dimensions.sourceWidth && dimensions.timeScale === 1 && !rotation) return score;
  const resized = rotation ? rotateMidiStamp(score.buffer, { rotationDegrees: rotation, pitchWidth: settings.widthNotes, pitchRange: score.pitchRange, heightBeats: settings.heightBeats })
    : transformMidiStamp(score.buffer, { pitchWidth: dimensions.width, pitchRange: score.pitchRange, timeScale: dimensions.timeScale });
  return { ...score, ...resized, notes: resized.analysis.notes, durationBeats: resized.analysis.durationBeats, duration: resized.analysis.durationSeconds };
}

/** Silent preparation over the same pitch/time coordinates as the live renderer. */
export function mountBlechDropStage(host, viewport, { getTempo = () => 120, getView = () => ({}), getBrush = () => ({ size: 1, velocity: 88 }),
  getWorkboxDrawingGesture = () => ({ tool: 'pencil', fill: 'outline' }), getWorkboxStamp = () => null, getWorkboxStampSize = () => ({}),
  onDrop, onSave, onSettings, onSettingsOpen, onGeneratorSettings, onCancel, onVisibility, onWorkboxToolChange, onRequestWorkboxStamp, onRequestWorkboxMath,
  onMathNoteReset, onFrameLayout } = {}) {
  const events = new AbortController(), on = (node, type, fn) => node.addEventListener(type, fn, { signal: events.signal });
  // Touch browsers can suppress a synthetic click just after a captured paint
  // drag. A real tap still needs to switch tools; keyboard/assistive clicks
  // retain their usual activation path. Ignore the matching synthetic click.
  const onTapOrClick = (button, action, ignore = () => false) => {
    let touch = null, tappedAt = -Infinity;
    on(button, 'pointerdown', event => { if (!ignore(event) && event.pointerType === 'touch' && event.isPrimary && event.button === 0)
      touch = { id: event.pointerId, x: event.clientX, y: event.clientY }; });
    on(button, 'pointercancel', event => { if (event.pointerId === touch?.id) touch = null; });
    on(button, 'pointerup', event => {
      if (event.pointerId !== touch?.id || event.pointerType !== 'touch') return;
      const tapped = Math.hypot(event.clientX - touch.x, event.clientY - touch.y) <= 12;
      touch = null;
      if (tapped) {
        tappedAt = performance.now();
        // A menu opened during pointerup can land beneath the finger before
        // the browser dispatches click. Wait until the tap has finished so it
        // cannot accidentally choose the first picture under that same tap.
        requestAnimationFrame(() => { if (!disposed) action(); });
      }
    });
    on(button, 'click', event => {
      if (ignore(event) || performance.now() - tappedAt < 750) return;
      action();
    });
  };
  host.innerHTML = `<div class="blech-drop-transport blech-drop-floating" role="toolbar" aria-label="Workbox actions">
      <button id="blechDropSend" data-stage-send data-primary-transport type="button" aria-label="Drop workbox and play" title="Drop · play with an editable layer frame" disabled><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3v14m-5-5 5 5 5-5M4 20h16"/></svg><span>Drop</span></button>
      <button id="blechDropLoop" data-stage-loop type="button" aria-label="Loop new layer" aria-pressed="false" title="Loop on: repeat after the last beat · off: play once">↻</button>
      <button id="blechDropSave" data-stage-save type="button" aria-label="Save to Layers" title="Drop and keep playing in Layers"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 3h14l3 3v15H3V3h1Zm1 0v6h12V3M7 21v-8h10v8m-8-4 2 2 4-4"/></svg></button>
      <div id="blechDropSourceTools" class="blech-drop-source-tools" hidden></div>
      <button id="blechDropMathSettings" type="button" aria-label="Math graph and note controls" title="Math · edit the equation and graph knobs" aria-controls="blechPanel-math" hidden><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M4 12h16M4 17h16"/><circle cx="9" cy="7" r="2" fill="#171c18"/><circle cx="16" cy="12" r="2" fill="#171c18"/><circle cx="10" cy="17" r="2" fill="#171c18"/></svg></button>
      <button id="blechDropChannelButton" type="button" aria-label="MIDI channel 1 and instrument" title="Choose MIDI channel and instrument" aria-expanded="false" aria-controls="blechDropChannelMenu"><span>ch<span data-channel-number>1</span></span><span class="blech-drop-caret" aria-hidden="true">⌄</span></button>
      <label class="blech-drop-volume" for="blechDropGain" title="Workbox volume · drag up/down or use arrow keys · 0–127">
        <input id="blechDropGain" aria-label="Workbox volume, 0 to 127" type="range" min="0" max="127" step="1" value="95">
        <output id="blechDropGainOut" for="blechDropGain" aria-hidden="true">95</output>
      </label>
      <button id="blechDropReset" type="button" aria-label="Reset workbox" title="Reset draft: clear decorations, restore frame, sound and Loop"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 11a8 8 0 1 1 1 6M4 4v7h7"/></svg></button>
      <button id="blechDropCancel" data-stage-cancel type="button" aria-label="Discard workbox draft" title="Cancel · discard this draft">×</button>
    </div>
    <section id="blechDropChannelMenu" class="blech-drop-menu" role="dialog" aria-label="Workbox MIDI channel and instrument" hidden>
      <label class="blech-drop-knob-control" for="blechDropChannel"><span>Channel</span><output id="blechDropChannelOut" for="blechDropChannel">1</output><input id="blechDropChannel" type="range" min="-1" max="15" step="1" value="0" aria-label="Workbox MIDI channel"></label>
      <label>Instrument<select id="blechDropProgram" aria-label="Drop instrument"><option value="original">Original instrument</option>${GM_PROGRAM_NAMES.map((name, i) => `<option value="${i}">${i + 1}. ${name}</option>`).join('')}</select></label>
    </section>
    <output id="blechDropStatus" class="blech-drop-status" role="status"></output>`;
  const $ = id => host.querySelector(`#blechDrop${id}`);
  const overlay = document.createElement('div'); overlay.className = 'blech-drop-overlay'; overlay.hidden = true;
  overlay.innerHTML = `<canvas aria-label="Prepared MIDI notes"></canvas><canvas class="blech-workbox-stroke" aria-hidden="true"></canvas><button class="blech-drop-handle" type="button" aria-label="Move prepared MIDI: left and right change pitch, up and down change delay" data-space-key-owner></button><div class="blech-workbox-paint" tabindex="0" role="group" aria-label="Paint notes in this workbox. Arrows choose pitch and time; hold Enter to place notes." data-space-key-owner></div>${['left', 'right', 'top', 'bottom', 'top-left', 'top-right', 'bottom-left', 'bottom-right'].map(edge => `<button class="blech-drop-resize" data-resize="${edge}" type="button" aria-label="Resize prepared MIDI ${edge.replace('-', ' ')} edge" title="Resize ${edge.replace('-', ' ')} · arrow keys adjust" data-space-key-owner></button>`).join('')}<button class="blech-drop-rotate" data-stage-rotate type="button" aria-label="Rotate prepared MIDI; left and right arrows change angle" title="Rotate frame · drag or use arrow keys" data-space-key-owner>↻</button>
    <section id="blechPanel-workbox" class="blech-workbox-tools" role="tabpanel" aria-labelledby="blechTab-workbox" hidden>
      <div class="blech-workbox-rail" role="toolbar" aria-label="Decorate workbox">
        <button id="blechWorkboxDraw" type="button" data-stage-paint aria-label="Draw in workbox" aria-pressed="false" aria-haspopup="dialog" aria-controls="blechBrushMenu" aria-expanded="false" aria-keyshortcuts="ArrowDown" title="Draw notes · click again to move the frame; corner arrow or Down Arrow for brushes">${DRAW_ICON}<span id="blechWorkboxBrush" class="blech-icon-caret" aria-hidden="true"><svg viewBox="0 0 16 8"><path d="m4 2 4 4 4-4"/></svg></span></button>
        <button id="blechWorkboxStamp" type="button" data-stage-stamp aria-label="Loop Stamp in workbox" aria-pressed="false" aria-controls="blechLoopStampMenu" aria-expanded="false" aria-haspopup="dialog" aria-keyshortcuts="ArrowDown" title="Place a stamp · corner arrow or Down Arrow for pictures and size">${LOOP_STAMP_ICON}<span id="blechWorkboxStampOptions" class="blech-icon-caret" aria-hidden="true"><svg viewBox="0 0 16 8"><path d="m4 2 4 4 4-4"/></svg></span></button>
        <button type="button" data-stage-text aria-label="Text in workbox" aria-pressed="false" title="Type text, then place it in the workbox">${TEXT_ICON}</button>
        <button id="blechWorkboxMath" type="button" data-stage-math aria-label="Math in workbox" aria-pressed="false" aria-controls="blechWorkboxMathMenu" aria-expanded="false" aria-haspopup="dialog" aria-keyshortcuts="ArrowDown" title="Choose a Math shape · tap inside this box to add it silently · corner arrow for shapes">${MATH_ICON}<span id="blechWorkboxMathOptions" class="blech-icon-caret" aria-hidden="true"><svg viewBox="0 0 16 8"><path d="m4 2 4 4 4-4"/></svg></span></button>
        <button id="blechWorkboxAddToggle" type="button" aria-label="Add prepared notes or open more sources" title="Add notes from another tool · or open more sources" aria-controls="blechWorkboxAddMenu" aria-haspopup="dialog" aria-expanded="false"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 4v16M4 12h16"/></svg></button>
      </div>
    </section>
    <section id="blechWorkboxAddMenu" class="blech-drop-menu blech-workbox-add-menu" role="dialog" aria-label="Add to workbox" hidden>
      <label>Add notes from<select id="blechWorkboxShape" aria-label="Prepared shape to add to workbox"><option value="math">Math</option><option value="text">Type</option><option value="stamps">Stamp</option><option value="files">File</option><option value="automata">Automata</option><option value="drawing">Drawing grid</option><option value="catch">Loop Select</option></select></label>
      <button id="blechWorkboxAdd" type="button">Add to box +</button>
      <button id="blechWorkboxNew" type="button">New empty box</button>
      <button id="blechWorkboxMore" type="button" aria-controls="blechPanel-frames">More sources →</button>
      <output id="blechWorkboxStatus" role="status"></output>
    </section>
    <form id="blechDropTextMenu" class="blech-drop-menu blech-drop-text-menu" role="dialog" aria-label="Workbox text" hidden><label for="blechDropText">Text to place</label><textarea id="blechDropText" rows="2" maxlength="128" placeholder="Write a word or symbol…"></textarea><label for="blechDropTextFont">Note font<select id="blechDropTextFont" aria-label="Workbox note font">${ULTRA_TEXT_FONTS.map(({ id, label }) => `<option value="${id}">${label}</option>`).join('')}</select></label><button type="submit">Place text</button></form>`;
  viewport.append(overlay);
  const canvas = overlay.querySelector('canvas'), ctx = canvas.getContext('2d'), paintCanvas = overlay.querySelector('.blech-workbox-stroke'), paintCtx = paintCanvas.getContext('2d');
  const handle = overlay.querySelector('.blech-drop-handle'), paintSurface = overlay.querySelector('.blech-workbox-paint');
  const workboxPanel = overlay.querySelector('#blechPanel-workbox');
  const rail = overlay.querySelector('.blech-workbox-rail'), paintButton = rail.querySelector('[data-stage-paint]');
  const inCorner = (event, selector) => {
    const caret = rail.querySelector(selector), rect = caret.getBoundingClientRect();
    return caret.contains(event.target) || Boolean(event.pointerType || event.detail)
      && event.clientX >= rect.left && event.clientX < rect.right && event.clientY >= rect.top && event.clientY < rect.bottom;
  };
  const rotate = overlay.querySelector('[data-stage-rotate]'), floating = host.querySelector('.blech-drop-transport');
  const channelMenu = $('ChannelMenu'), textMenu = overlay.querySelector('#blechDropTextMenu');
  const addMenu = overlay.querySelector('#blechWorkboxAddMenu'), addButton = rail.querySelector('#blechWorkboxAddToggle');
  overlay.append(floating, channelMenu, $('Status'));
  const inputs = id => overlay.querySelector(`#blechDrop${id}`);
  const sourceTools = inputs('SourceTools');
  let score = null, prepared = null, source = 'files', draftKey = null, name = '', disposed = false, pointer = null, shown = true, dropped = false, interactionsSuspended = false;
  let mathPreviewScore = null, draftError = '';
  let workbox = null, savedWorkbox = null, painting = false, workboxTool = 'draw', workboxText = null, workboxMath = null, paintPointer = null, paintFrame = null, keyboardPaint = false, paintCursor = null;
  let settings = { channel: null, program: 'original', gain: .75, transpose: 0, delayBeats: 2, widthNotes: null, heightBeats: null, rotationDegrees: 0, loop: false };
  const sourceSettings = new Map(), sourceInitialSettings = new Map();
  let initialSettings = null;
  function closeMenus(restoreFocus = false) {
    for (const [menu, button] of [[channelMenu, inputs('ChannelButton')],
      [textMenu, rail.querySelector('[data-stage-text]')], [addMenu, addButton]]) {
      if (menu.hidden) continue;
      menu.hidden = true;
      button.setAttribute('aria-expanded', 'false');
      if (restoreFocus) button.focus({ preventScroll: true });
    }
  }
  function toggleMenu(menu, opener, focus) {
    const opening = menu.hidden;
    closeMenus();
    if (!opening || (!prepared && !workbox) || !shown || interactionsSuspended) return;
    onSettingsOpen?.(); menu.hidden = false; opener.setAttribute('aria-expanded', 'true');
    render();
    focus.focus({ preventScroll: true });
  }
  function tuck() { shown = false; finishPaint(true); closeMenus(); render(); }
  function discard() {
    mathPreviewScore = null;
    if (!score && !workbox) return;
    const cancelled = source, key = draftKey;
    if (workbox) { savedWorkbox = null; workbox = null; painting = false; finishPaint(true); }
    score = null; prepared = null; draftKey = null; draftError = ''; shown = false; dropped = false; pointer = null;
    closeMenus(); inputs('Status').value = ''; render(); onCancel?.(cancelled, key);
  }
  function geometry() { const rect = viewport.getBoundingClientRect(); return { width: rect.width, height: rect.height, ...blackMidiTimeGeometry(getView(), rect.height, rect.width) }; }
  const dimensionsFor = options => workbox ? workboxDimensions(workbox, options) : dropScoreDimensions(score, options);
  function rememberWorkbox() {
    if (workbox) savedWorkbox = { box: workbox, settings: { ...settings }, initialSettings, tool: workboxTool, painting, text: workboxText, math: workboxMath };
  }
  function rebuildWorkbox() {
    prepared = workbox?.notes.length ? blechStrokeScore(workboxRenderedNotes(workbox, settings), dimensionsFor(settings).heightBeats, name) : null;
    score = prepared;
    rememberWorkbox();
  }
  function render(redraw = true) {
    if (disposed) return;
    const notes = prepared?.analysis?.notes ?? [];
    const dimensions = dimensionsFor(settings), hasDraft = Boolean(notes.length || workbox);
    overlay.hidden = !hasDraft || !shown || interactionsSuspended;
    inputs('Send').disabled = inputs('Save').disabled = !notes.length || Boolean(draftError);
    for (const id of ['ChannelButton', 'Gain', 'Reset', 'Cancel']) inputs(id).disabled = !hasDraft;
    onVisibility?.({ hasDraft: Boolean(hasDraft && !dropped), visible: Boolean(hasDraft && shown && !interactionsSuspended), source });
    const volume = Math.round(bound(settings.gain, 0, 1, .75) * WORKBOX_VOLUME_MAX);
    if (document.activeElement !== inputs('Gain')) inputs('Gain').value = String(volume);
    if (document.activeElement !== inputs('Program')) inputs('Program').value = String(settings.program);
    if (document.activeElement !== inputs('Channel')) inputs('Channel').value = String(settings.channel ?? -1);
    inputs('ChannelOut').value = settings.channel === null ? 'Original' : String(settings.channel + 1);
    inputs('Channel').setAttribute('aria-valuetext', settings.channel === null ? 'Original channels'
      : `Channel ${settings.channel + 1}${settings.channel === 9 ? ', drums' : ''}`);
    inputs('ChannelButton').querySelector('[data-channel-number]').textContent = settings.channel === null ? '—' : String(settings.channel + 1);
    inputs('ChannelButton').setAttribute('aria-label', settings.channel === null ? 'Original MIDI channels and instrument'
      : `MIDI channel ${settings.channel + 1} and instrument`);
    inputs('ChannelButton').title = settings.channel === null ? 'Original MIDI channels · choose channel and instrument'
      : `Channel ${settings.channel + 1}${settings.channel === 9 ? ' · drums' : ''} · choose instrument`;
    inputs('GainOut').value = String(volume);
    inputs('Loop').setAttribute('aria-pressed', String(settings.loop));
    for (const tool of sourceTools.children) {
      tool.hidden = tool.dataset.workboxSource !== source;
      if (tool.hidden) for (const details of tool.querySelectorAll('details[open]')) details.open = false;
    }
    sourceTools.hidden = ![...sourceTools.children].some(tool => !tool.hidden);
    inputs('MathSettings').hidden = source !== 'math';
    overlay.dataset.workboxPaint = String(Boolean(workbox && painting));
    overlay.dataset.workboxTool = workbox && painting ? workboxTool : 'move';
    workboxPanel.hidden = !workbox;
    for (const [mode, button] of [['draw', paintButton], ['stamp', rail.querySelector('[data-stage-stamp]')],
      ['text', rail.querySelector('[data-stage-text]')], ['math', rail.querySelector('[data-stage-math]')]])
      button.setAttribute('aria-pressed', String(Boolean(workbox && painting && workboxTool === mode)));
    paintSurface.tabIndex = workbox && painting && !overlay.hidden ? 0 : -1;
    paintSurface.setAttribute('aria-label', workboxTool === 'draw' && getWorkboxDrawingGesture().tool === 'line'
      ? 'Click line anchors in the silent workbox; double-click to add the path. Arrow keys position, Enter adds anchors, Space finishes, Escape cancels.'
      : workboxTool === 'stamp'
      ? 'Stamp in the silent workbox. Arrows choose pitch and time; press Enter to place a stamp.'
      : workboxTool === 'text'
        ? 'Place text in the silent workbox. Arrows choose pitch and time; press Enter to place text.'
        : workboxTool === 'math'
          ? 'Place a Math shape in this silent workbox. Arrows choose pitch and time; press Enter to add it.'
        : 'Draw in the silent workbox. Arrows choose pitch and time; hold Enter to draw.');
    overlay.dataset.source = source; overlay.dataset.noteCount = String(notes.length);
    overlay.dataset.transpose = String(settings.transpose); overlay.dataset.delayBeats = String(settings.delayBeats); overlay.dataset.widthNotes = String(dimensions.width); overlay.dataset.heightBeats = String(dimensions.heightBeats); overlay.dataset.rotationDegrees = String(settings.rotationDegrees);
    if (overlay.hidden) { closeMenus(); return; }
    if (!redraw) return; // Routing, Loop and volume must not redraw thousands of MIDI notes per slider input.
    const g = geometry(); if (!g.width || !g.height) return;
    const dpr = Math.min(globalThis.devicePixelRatio || 1, 2);
    const width = Math.round(g.width * dpr), height = Math.round(g.height * dpr);
    if (canvas.width !== width || canvas.height !== height) { canvas.width = width; canvas.height = height; }
    else ctx.clearRect(0, 0, width, height);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    if (paintCanvas.width !== width || paintCanvas.height !== height) { paintCanvas.width = width; paintCanvas.height = height; }
    paintCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const layout = blackMidiKeyLayout(getView().alignment), secondsPerBeat = 60 / Math.max(1, getTempo()), scale = g.velocity * g.height * secondsPerBeat, present = g.keyboardTop * g.height;
    const inkPixels = blackMidiPixelLayout(layout, width);
    const lowKey = layout[workbox ? dimensions.low : dimensions.low + settings.transpose], highKey = layout[workbox ? dimensions.high : dimensions.high + settings.transpose];
    let left = lowKey.x * g.width, right = (highKey.x + highKey.width) * g.width, top = present - (settings.delayBeats + dimensions.heightBeats) * scale, bottom = present - settings.delayBeats * scale;
    ctx.fillStyle = '#c7ff2a';
    // Preview is bounded independently of the audible score. Sending retains every note.
    const stride = Math.max(1, Math.ceil(notes.length / 8192));
    for (let i = 0; i < notes.length; i += stride) {
      const n = notes[i], key = inkPixels[n.note + (workbox ? 0 : settings.transpose)]; if (!key) continue;
      const x = key.left / dpr, w = key.noteWidth / dpr, y = present - (settings.delayBeats + n.beat + n.duration) * scale, b = present - (settings.delayBeats + n.beat) * scale;
      if (b < 0 || y > present) continue;
      ctx.globalAlpha = .6; ctx.fillRect(x, Math.max(0, y), w, Math.max(1, Math.min(present, b) - Math.max(0, y)));
    }
    ctx.globalAlpha = 1;
    const handleStyle = getComputedStyle(handle);
    const minWidth = Math.min(g.width, Math.max(32, parseFloat(handleStyle.minWidth) || 0));
    const minHeight = Math.min(present, Math.max(32, parseFloat(handleStyle.minHeight) || 0));
    left = bound(left - 4, 0, Math.max(0, g.width - minWidth)); right = bound(right + 4, left + minWidth, g.width);
    top = bound(top - 4, 0, Math.max(0, present - minHeight)); bottom = bound(bottom + 4, top + minHeight, present);
    Object.assign(handle.style, { left: `${left}px`, top: `${top}px`, width: `${right - left}px`, height: `${bottom - top}px` });
    Object.assign(paintSurface.style, { left: `${left}px`, top: `${top}px`, width: `${right - left}px`, height: `${bottom - top}px` });
    for (const grip of overlay.querySelectorAll('[data-resize]')) {
      const edge = grip.dataset.resize, x = edge.includes('left') ? left : edge.includes('right') ? right : (left + right) / 2, y = edge.includes('top') ? top : edge.includes('bottom') ? bottom : (top + bottom) / 2;
      Object.assign(grip.style, { left: `${x}px`, top: `${y}px` });
      grip.disabled = (edge === 'left' || edge === 'right') && dimensions.sourceWidth === 1 && !settings.rotationDegrees;
    }
    const rotateSize = rotate.offsetWidth || 28, rotationOffset = rotateSize / 2 + 22;
    let rotateX = (left + right) / 2, rotateY = top - rotationOffset;
    if (rotateY < rotateSize / 2 + 2) {
      rotateX = right + rotationOffset + rotateSize / 2 <= g.width ? right + rotationOffset : left - rotationOffset;
      rotateY = top;
    }
    Object.assign(rotate.style, { left: `${bound(rotateX, rotateSize / 2 + 2, g.width - rotateSize / 2 - 2)}px`,
      top: `${bound(rotateY, rotateSize / 2 + 2, Math.max(rotateSize / 2 + 2, present - rotateSize / 2 - 2))}px` });
    onFrameLayout?.({ left, right, top, bottom, stageRect: viewport.getBoundingClientRect(), source });
    const actionHeight = floating.offsetHeight, keyboardBottom = g.keyboardBottom * g.height;
    let actionTop = Math.max(bottom, Math.min(bottom + 20, g.height - actionHeight));
    if (actionTop < keyboardBottom && actionTop + actionHeight > present) {
      if (present - bottom >= actionHeight) actionTop = present - actionHeight;
      else if (g.height - keyboardBottom >= actionHeight) actionTop = keyboardBottom;
      else actionTop = Math.max(bottom, g.height - actionHeight);
    }
    let actionLeft = bound(left, 0, Math.max(0, g.width - floating.offsetWidth));
    const workspace = viewport.closest('#blechMidi'), stageRect = viewport.getBoundingClientRect();
    // Only one right-side panel is visible at a time. Place Workbox actions
    // clear of that panel and frame grips, even while Layers stays open.
    const obstructions = [workspace?.querySelector('.blech-workbench'), workspace?.querySelector('#blechLayers')]
      .filter(node => node?.getClientRects().length && getComputedStyle(node).visibility !== 'hidden')
      .map(node => {
        const rect = node.getBoundingClientRect();
        return { left: rect.left - stageRect.left, right: rect.right - stageRect.left,
          top: rect.top - stageRect.top, bottom: rect.bottom - stageRect.top };
      })
      .filter(rect => rect.right > 0 && rect.left < g.width && rect.bottom > 0 && rect.top < g.height);
    const grips = [...overlay.querySelectorAll('[data-resize]:not(:disabled)')].map(node => {
      const rect = node.getBoundingClientRect();
      return { left: rect.left - stageRect.left, right: rect.right - stageRect.left,
        top: rect.top - stageRect.top, bottom: rect.bottom - stageRect.top };
    });
    const actionBlockers = [...obstructions, ...grips];
    const actionWidth = floating.offsetWidth;
    const overlap = (x, y) => actionBlockers.reduce((area, rect) => area
      + Math.max(0, Math.min(x + actionWidth + 4, rect.right) - Math.max(x - 4, rect.left))
        * Math.max(0, Math.min(y + actionHeight + 4, rect.bottom) - Math.max(y - 4, rect.top)), 0);
    if (overlap(actionLeft, actionTop)) {
      // The drawer, Layers and frame grips can all steal workbox clicks. Find
      // the nearest clear spot instead of hiding an edge under the actions.
      const maxLeft = Math.max(0, g.width - actionWidth), maxTop = Math.max(0, g.height - actionHeight);
      const initialLeft = actionLeft, initialTop = actionTop;
      const xs = [actionLeft, 8, maxLeft - 8, ...actionBlockers.flatMap(rect => [rect.left - actionWidth - 6, rect.right + 6])];
      const ys = [actionTop, 8, maxTop - 8, ...actionBlockers.flatMap(rect => [rect.top - actionHeight - 6, rect.bottom + 6])];
      let best = Infinity;
      for (const x of xs) for (const y of ys) {
        const cx = bound(x, 0, maxLeft), cy = bound(y, 0, maxTop);
        const rank = overlap(cx, cy) * 10000 + Math.abs(cx - initialLeft) + Math.abs(cy - initialTop);
        if (rank < best) { best = rank; actionLeft = cx; actionTop = cy; }
      }
    }
    Object.assign(floating.style, { left: `${actionLeft}px`, top: `${actionTop}px` });
    if (workbox) {
      // A rail may fit on its own yet cross the frame's bottom transport.
      // On shallow stages use a row before either set of full-size targets
      // must overlap, without shrinking the buttons or losing Add.
      rail.dataset.compact = String(g.height < rail.firstElementChild.offsetHeight * rail.childElementCount
        + floating.offsetHeight + 16);
      // Follow the frame's top-right corner, not the graphic's top-right.
      // Fall back above or to its left only when an edge/grip blocks the rail.
      const railWidth = rail.offsetWidth, railHeight = rail.offsetHeight;
      const maxLeft = Math.max(8, g.width - railWidth - 8), maxTop = Math.max(8, g.height - railHeight - 8);
      const idealLeft = right + 32, idealTop = top;
      const blockers = [...obstructions, ...grips, { left, right, top, bottom },
        { left: actionLeft, right: actionLeft + actionWidth,
        top: actionTop, bottom: actionTop + actionHeight },
        { left: parseFloat(rotate.style.left) - rotateSize / 2, right: parseFloat(rotate.style.left) + rotateSize / 2,
          top: parseFloat(rotate.style.top) - rotateSize / 2, bottom: parseFloat(rotate.style.top) + rotateSize / 2 }];
      let leftRail = idealLeft, topRail = idealTop, best = Infinity;
      const xs = [idealLeft, right - railWidth, left - railWidth - 32, left + 8, 8, maxLeft,
        ...obstructions.flatMap(rect => [rect.left - railWidth - 8, rect.right + 8])];
      const ys = [idealTop, top - railHeight - 12, bottom + 12, bottom - railHeight, 8, maxTop,
        ...obstructions.flatMap(rect => [rect.top - railHeight - 8, rect.bottom + 8])];
      for (const x of xs) for (const y of ys) {
        const cx = bound(x, 8, maxLeft), cy = bound(y, 8, maxTop);
        const covered = blockers.reduce((area, rect) => area
          + Math.max(0, Math.min(cx + railWidth + 4, rect.right) - Math.max(cx - 4, rect.left))
            * Math.max(0, Math.min(cy + railHeight + 4, rect.bottom) - Math.max(cy - 4, rect.top)), 0);
        const rank = covered * 10000 + Math.abs(cx - idealLeft) + Math.abs(cy - idealTop);
        if (rank < best) { best = rank; leftRail = cx; topRail = cy; }
      }
      Object.assign(rail.style, { left: `${leftRail}px`, top: `${topRail}px` });
    }
    for (const [menu, button] of [[channelMenu, inputs('ChannelButton')],
      [textMenu, rail.querySelector('[data-stage-text]')], [addMenu, addButton]]) {
      if (menu.hidden) continue;
      const width = menu.offsetWidth, height = menu.offsetHeight, anchor = button.getBoundingClientRect();
      const x = anchor.left - stageRect.left, y = anchor.top - stageRect.top;
      if (menu === channelMenu) {
        // Keep the picker attached to its button: align left when there is
        // room, otherwise align right. A wrapped toolbar has more buttons
        // below ch, so place the menu outside the entire toolbar.
        const inset = 8, gap = 6;
        const menuRight = Math.max(inset, g.width - width - inset);
        let menuLeft = bound(x + width <= g.width - inset ? x : x + anchor.width - width, inset, menuRight);
        const below = actionTop + actionHeight + gap, above = actionTop - height - gap;
        let menuTop;
        if (below + height <= g.height - inset) menuTop = below;
        else if (above >= inset) menuTop = above;
        else {
          const right = x + anchor.width + gap, left = x - width - gap;
          if (right + width <= g.width - inset) menuLeft = right;
          else if (left >= inset) menuLeft = left;
          menuTop = bound(y + (anchor.height - height) / 2, inset, Math.max(inset, g.height - height - inset));
        }
        Object.assign(menu.style, { left: `${menuLeft}px`, top: `${menuTop}px` });
        continue;
      }
      const blockers = [...obstructions, { left: actionLeft, right: actionLeft + actionWidth,
        top: actionTop, bottom: actionTop + actionHeight }];
      const xs = [x, x + anchor.width - width, x + anchor.width + 6, x - width - 6,
        actionLeft + actionWidth + 8, left - width - 8, right + 8, 8, g.width - width - 8];
      const ys = [y + anchor.height + 6, y - height - 6, actionTop + actionHeight + 8,
        actionTop - height - 8, 8, g.height - height - 8];
      let best = Infinity, menuLeft = 8, menuTop = 8;
      for (const cx of xs) for (const cy of ys) {
        const mx = bound(cx, 8, Math.max(8, g.width - width - 8)), my = bound(cy, 8, Math.max(8, g.height - height - 8));
        const covered = blockers.reduce((area, rect) => area + Math.max(0, Math.min(mx + width, rect.right) - Math.max(mx, rect.left))
          * Math.max(0, Math.min(my + height, rect.bottom) - Math.max(my, rect.top)), 0);
        // A local popup may cover Layers when space is tight, but it must
        // never block its own channel or text trigger.
        const openerOverlap = Math.max(0, Math.min(mx + width, x + anchor.width + 4) - Math.max(mx, x - 4))
          * Math.max(0, Math.min(my + height, y + anchor.height + 4) - Math.max(my, y - 4));
        const rank = (openerOverlap ? 1e12 + openerOverlap * 1e6 : 0)
          + covered * 10000 + Math.abs(mx - x) + Math.abs(my - (y + anchor.height + 6));
        if (rank < best) { best = rank; menuLeft = mx; menuTop = my; }
      }
      Object.assign(menu.style, { left: `${menuLeft}px`, top: `${menuTop}px` });
    }
  }
  function configure(patch) {
    const previous = settings;
    const needsFirstDraw = !prepared;
    const next = { ...settings, ...patch };
    next.rotationDegrees = ((Number(next.rotationDegrees) || 0) % 360 + 360) % 360;
    try {
      const dimensions = dimensionsFor(next);
      if (next.widthNotes !== null) next.widthNotes = dimensions.width;
      if (next.heightBeats !== null) next.heightBeats = dimensions.heightBeats;
      const originLow = workbox ? workboxDimensions(workbox, { ...next, transpose: 0 }).low : null;
      // A new draft has a source score before its preview is built. Constrain
      // against that source, or the first centered Math box loses its offset.
      const bounds = workbox ? [{ note: originLow }, { note: originLow + dimensions.width - 1 }]
        : score?.analysis?.notes?.length ? [{ note: dimensions.low }, { note: dimensions.high }] : [];
      settings = { ...next, ...constrainDropPosition(bounds, next) };
      const scoreChanged = next.widthNotes !== previous.widthNotes || next.heightBeats !== previous.heightBeats
        || next.rotationDegrees !== previous.rotationDegrees || settings.transpose !== previous.transpose;
      const geometryChanged = scoreChanged || settings.delayBeats !== previous.delayBeats;
      if (workbox) {
        if (needsFirstDraw || scoreChanged) rebuildWorkbox();
        else rememberWorkbox();
      }
      else if (needsFirstDraw || next.widthNotes !== previous.widthNotes || next.heightBeats !== previous.heightBeats || next.rotationDegrees !== previous.rotationDegrees)
        prepared = resizeDropScore(score, settings);
      // Newly prepared notes need their first canvas/toolbar layout even when
      // the next draft reuses the previous draft's frame settings.
      sourceSettings.set(source, { ...settings }); render(geometryChanged || needsFirstDraw); onSettings?.({ ...settings, source });
    } catch (error) { render(); inputs('Status').value = error.message; }
  }
  function send() {
    if (!prepared?.analysis?.notes.length || draftError || disposed) return null;
    try {
      // A hand-filled box already contains its transformed notes. A second
      // pitch/time transform in the layer engine would move them twice.
      const options = workbox ? { ...settings, transpose: 0, widthNotes: null, heightBeats: null, rotationDegrees: 0 }
        : { ...settings };
      const sent = onDrop?.(prepared, { ...options, source, name, quantize: false });
      if (!sent) return null;
      if (source === 'math') mathPreviewScore = null;
      shown = false; dropped = true; finishPaint(true); closeMenus();
      if (workbox) { savedWorkbox = null; workbox = null; painting = false; score = null; prepared = null; }
      inputs('Status').value = `${name} sent${settings.loop ? ' · looping' : ' · one shot'}`; render(); return sent;
    } catch (error) { inputs('Status').value = error.message; return null; }
  }
  on(inputs('Send'), 'click', send);
  on(inputs('Save'), 'click', () => { const sent = send(); if (sent) onSave?.(sent); });
  on(inputs('Loop'), 'click', () => configure({ loop: !settings.loop }));
  function setWorkboxTool(tool, { toggle = false } = {}) {
    if (!workbox || source !== 'workbox' || !['draw', 'stamp', 'text', 'math'].includes(tool)) return;
    finishPaint(true); closeMenus();
    painting = !(toggle && workboxTool === tool && painting);
    workboxTool = tool; shown = true; rememberWorkbox(); render();
    onWorkboxToolChange?.(workboxTool);
    (painting ? paintSurface : handle).focus({ preventScroll: true });
  }
  function setWorkboxMath(next) {
    if (!workbox || source !== 'workbox' || !next?.analysis?.notes?.length) return false;
    try {
      workboxStampBounds(next, workbox, { pitchRange: next.pitchRange });
      workboxMath = next; setWorkboxTool('math');
      inputs('Status').value = 'Tap in this workbox to place the Math shape. It stays silent until Drop.';
      return true;
    } catch (error) { inputs('Status').value = error.message; return false; }
  }
  onTapOrClick(paintButton, () => setWorkboxTool('draw', { toggle: true }),
    event => inCorner(event, '#blechWorkboxBrush'));
  onTapOrClick(rail.querySelector('[data-stage-stamp]'), () => {
    if (workboxTool === 'stamp' && painting) { setWorkboxTool('stamp', { toggle: true }); return; }
    if (!getWorkboxStamp()?.analysis?.notes?.length) { onRequestWorkboxStamp?.(); return; }
    setWorkboxTool('stamp'); configure({ loop: true });
  }, event => inCorner(event, '#blechWorkboxStampOptions'));
  onTapOrClick(rail.querySelector('[data-stage-text]'), () => {
    if (workboxTool === 'text' && painting) { setWorkboxTool('text', { toggle: true }); return; }
    toggleMenu(textMenu, rail.querySelector('[data-stage-text]'), inputs('Text'));
  });
  onTapOrClick(rail.querySelector('[data-stage-math]'), () => {
    if (workboxTool === 'math' && painting) { setWorkboxTool('math', { toggle: true }); return; }
    if (!workboxMath) { onRequestWorkboxMath?.(); return; }
    setWorkboxTool('math');
  }, event => inCorner(event, '#blechWorkboxMathOptions'));
  onTapOrClick(addButton, () => toggleMenu(addMenu, addButton, overlay.querySelector('#blechWorkboxShape')));
  on(textMenu, 'submit', event => {
    event.preventDefault();
    try {
      const message = inputs('Text').value;
      // Generate and parse once per submitted message, not per pointer move
      // or visual refresh. Place the cached score using the bounded stamp map.
      const font = inputs('TextFont').value;
      if (workbox.width < ultraTextGlyphColumns(font))
        throw new Error(`Widen the workbox to at least ${ultraTextGlyphColumns(font)} notes to place legible text.`);
      const next = generateUltraTextMidi(message, { font, span: Math.min(48, workbox.width), lowestNote: 0,
        beats: Math.min(2, workbox.heightBeats), fit: true });
      workboxText = { ...next, analysis: parseMidi(next.buffer) };
      if (workboxText.analysis.notes.length > WORKBOX_NOTE_LIMIT) throw new Error('Try shorter text (up to 4,096 notes).');
      closeMenus(); setWorkboxTool('text');
      inputs('Status').value = 'Click inside the workbox to place your text. It stays silent until Drop.';
    } catch (error) { inputs('Status').value = error.message || 'Type text to place.'; }
  });
  function displayedPaintPoint(event, gesture) {
    const size = dimensionsFor(settings), { rect, g, layout } = gesture;
    const position = bound((event.clientX - rect.left) / g.width, 0, 1);
    const pitch = bound(blackMidiPitchAtX(position, layout), size.low, size.high);
    const scale = g.velocity * g.height * 60 / Math.max(1, getTempo());
    const beat = bound((g.keyboardTop * g.height - (event.clientY - rect.top)) / Math.max(.001, scale) - settings.delayBeats,
      0, size.heightBeats - 1 / PPQ);
    return { pitch, beat };
  }
  function rawPaintPoint(point) {
    const size = dimensionsFor(settings), radians = settings.rotationDegrees * Math.PI / 180;
    const x = (point.pitch - size.low) / Math.max(1, size.width - 1) - .5, y = point.beat / size.heightBeats - .5;
    const cosine = Math.cos(radians), sine = Math.sin(radians);
    return { pitch: workbox.low + Math.round(bound(.5 + x * cosine + y * sine, 0, 1, .5) * (workbox.width - 1)),
      beat: bound((.5 - x * sine + y * cosine) * workbox.heightBeats, 0, workbox.heightBeats - WORKBOX_GRID) };
  }
  function paintPreview() {
    paintFrame = null;
    paintCtx.clearRect(0, 0, paintCanvas.width, paintCanvas.height);
    if (!paintPointer || overlay.hidden) return;
    const g = paintPointer.g, layout = paintPointer.layout, scale = g.velocity * g.height * 60 / Math.max(1, getTempo());
    paintCtx.lineWidth = 3; paintCtx.strokeStyle = '#c7ff2a'; paintCtx.lineCap = 'round'; paintCtx.lineJoin = 'round';
    const screen = point => {
      const key = layout[point.pitch];
      return { x: (key.x + key.width / 2) * g.width,
        y: g.keyboardTop * g.height - (settings.delayBeats + point.beat) * scale };
    };
    const { tool, points } = paintPointer, start = screen(points[0]), end = screen(paintPointer.end ?? points.at(-1));
    paintCtx.beginPath();
    if (tool === 'stamp' || tool === 'text' || tool === 'math') {
      const { width, duration } = paintPointer.stampBounds;
      paintCtx.setLineDash([4, 3]); paintCtx.rect(end.x - Math.max(8, width / 128 * g.width) / 2,
        end.y - Math.max(8, duration * scale), Math.max(8, width / 128 * g.width), Math.max(8, duration * scale));
    } else if (tool === 'line') {
      paintCtx.moveTo(start.x, start.y);
      for (const point of points.slice(1)) {
        const next = screen(point); paintCtx.lineTo(next.x, next.y);
      }
      paintCtx.stroke(); paintCtx.beginPath(); paintCtx.setLineDash([4, 3]);
      const last = screen(points.at(-1)); paintCtx.moveTo(last.x, last.y); paintCtx.lineTo(end.x, end.y);
    }
    else if (tool === 'rectangle') paintCtx.rect(Math.min(start.x, end.x), Math.min(start.y, end.y), Math.abs(end.x - start.x), Math.abs(end.y - start.y));
    else if (tool === 'ellipse') paintCtx.ellipse((start.x + end.x) / 2, (start.y + end.y) / 2,
      Math.max(1, Math.abs(end.x - start.x) / 2), Math.max(1, Math.abs(end.y - start.y) / 2), 0, 0, Math.PI * 2);
    else if (tool === 'triangle') {
      paintCtx.moveTo((start.x + end.x) / 2, Math.min(start.y, end.y));
      paintCtx.lineTo(Math.max(start.x, end.x), Math.max(start.y, end.y));
      paintCtx.lineTo(Math.min(start.x, end.x), Math.max(start.y, end.y)); paintCtx.closePath();
    } else for (const [index, point] of points.entries()) {
      const { x, y } = screen(point);
      if (index) paintCtx.lineTo(x, y); else paintCtx.moveTo(x, y);
    }
    paintCtx.stroke();
    paintCtx.setLineDash([]);
    if (tool === 'line') {
      paintCtx.fillStyle = '#f2f1e6';
      for (const point of points) {
        const { x, y } = screen(point); paintCtx.fillRect(x - 3, y - 3, 6, 6);
      }
    }
    if (tool === 'pencil' && points.length === 1) {
      const point = points[0], key = layout[point.pitch];
      paintCtx.fillStyle = '#c7ff2a'; paintCtx.fillRect(key.x * g.width,
        g.keyboardTop * g.height - (settings.delayBeats + point.beat) * scale - 2, Math.max(3, key.width * g.width), 4);
    }
  }
  function queuePaintPreview() { if (paintFrame === null) paintFrame = requestAnimationFrame(paintPreview); }
  function beginPaint(point, id = null, gesture = null) {
    if (!workbox || !painting || paintPointer) return;
    const rect = viewport.getBoundingClientRect(), g = geometry(), layout = blackMidiKeyLayout(getView().alignment);
    const drawing = getWorkboxDrawingGesture(), tool = ['stamp', 'text', 'math'].includes(workboxTool) ? workboxTool : drawing.tool;
    const stamp = tool === 'stamp' ? getWorkboxStamp() : tool === 'text' ? workboxText : tool === 'math' ? workboxMath : null;
    if (['stamp', 'text', 'math'].includes(tool) && !stamp?.analysis?.notes?.length) {
      inputs('Status').value = tool === 'stamp' ? 'Choose a stamp in the Workbox tools first.'
        : tool === 'math' ? 'Choose a Math shape in the Workbox tools first.' : 'Type text to place first.'; return;
    }
    // Leave room to place more than one graph in a frame. A flat equation
    // keeps the same canvas envelope as a tall one, not a one-pitch stamp.
    const stampSize = tool === 'math' ? { widthNotes: Math.ceil(workbox.width / 2),
      heightBeats: Math.max(.25, workbox.heightBeats / 2), pitchRange: stamp.pitchRange }
      : tool === 'text' ? {} : stamp ? { ...getWorkboxStampSize() } : null;
    let stampBounds = null;
    if (stamp) {
      try {
        const bounds = workboxStampBounds(stamp, workbox, stampSize);
        stampBounds = { width: bounds.width, duration: bounds.height };
      } catch (error) { inputs('Status').value = error.message; return; }
    }
    paintPointer = { id, rect, g, layout, points: [point ?? displayedPaintPoint(gesture, { rect, g, layout })],
      tool, fill: drawing.fill, brush: { ...getBrush() }, stamp, stampSize, stampBounds, lastTap: null };
    queuePaintPreview();
  }
  function movePaint(point) {
    if (!paintPointer) return;
    const last = paintPointer.tool === 'line' ? paintPointer.end ?? paintPointer.points.at(-1) : paintPointer.points.at(-1);
    if (last.pitch === point.pitch && Math.abs(last.beat - point.beat) < WORKBOX_GRID / 2) return;
    if (paintPointer.tool === 'pencil') {
      if (paintPointer.points.length < 2048) paintPointer.points.push(point);
    } else if (paintPointer.tool === 'line') paintPointer.end = point;
    else paintPointer.points[1] = point;
    queuePaintPreview();
  }
  function placeLineAnchor(point, event = null) {
    if (paintPointer?.tool !== 'line') return;
    const capture = paintPointer, last = capture.points.at(-1), now = performance.now();
    if ((last.pitch !== point.pitch || Math.abs(last.beat - point.beat) >= WORKBOX_GRID / 2) && capture.points.length < 64)
      capture.points.push(point);
    capture.end = point;
    const twice = event?.pointerType === 'touch' && capture.lastTap && now - capture.lastTap.at <= 550
      && Math.hypot(event.clientX - capture.lastTap.x, event.clientY - capture.lastTap.y) <= 12;
    capture.lastTap = event ? { x: event.clientX, y: event.clientY, at: now } : null;
    const id = capture.id; capture.id = null;
    if (id !== null && paintSurface.hasPointerCapture?.(id)) paintSurface.releasePointerCapture(id);
    if (twice && capture.points.length >= 2) finishPaint();
    else {
      inputs('Status').value = `${capture.points.length} line anchors · double-click to add them to the silent box.`;
      queuePaintPreview();
    }
  }
  function finishPaint(cancelled = false) {
    if (!paintPointer) return;
    const capture = paintPointer; paintPointer = null;
    if (capture.id !== null && paintSurface.hasPointerCapture?.(capture.id)) paintSurface.releasePointerCapture(capture.id);
    if (paintFrame !== null) { cancelAnimationFrame(paintFrame); paintFrame = null; }
    paintCtx.clearRect(0, 0, paintCanvas.width, paintCanvas.height);
    if (!cancelled && workbox) {
      try {
        const start = rawPaintPoint(capture.points[0]), end = rawPaintPoint(capture.points.at(-1));
        const additions = ['stamp', 'text', 'math'].includes(capture.tool)
          ? workboxStampNotes(capture.stamp, workbox, end, capture.stampSize ?? {})
          : capture.tool === 'pencil' ? workboxStrokeNotes(capture.points.map(rawPaintPoint), workbox, capture.brush)
            : workboxGeometryNotes(capture.tool, capture.tool === 'line' ? capture.points.map(rawPaintPoint) : start,
              end, workbox, capture.brush, capture.fill);
        if (workbox.notes.length + additions.length > WORKBOX_NOTE_LIMIT) throw new Error('This workbox holds up to 4,096 notes.');
        if (additions.length) {
          workbox = { ...workbox, notes: [...workbox.notes, ...additions] }; rebuildWorkbox(); render();
          inputs('Status').value = `${workbox.notes.length} notes in the silent workbox. Drop when ready.`;
        }
      } catch (error) { inputs('Status').value = error.message || 'Could not add notes to the workbox.'; }
    }
  }
  on(paintSurface, 'pointerdown', event => {
    if (!painting || event.button !== 0 || !event.isPrimary) return;
    event.preventDefault(); paintSurface.focus({ preventScroll: true }); paintSurface.setPointerCapture(event.pointerId);
    if (paintPointer?.tool === 'line' && paintPointer.id === null) {
      paintPointer.id = event.pointerId; movePaint(displayedPaintPoint(event, paintPointer));
    } else beginPaint(null, event.pointerId, event);
  });
  on(paintSurface, 'pointermove', event => {
    if (!paintPointer || paintPointer.id !== event.pointerId
      && !(paintPointer.tool === 'line' && paintPointer.id === null)) return;
    const samples = paintPointer.tool === 'pencil' ? event.getCoalescedEvents?.() : null;
    for (const sample of samples?.length ? samples : [event]) movePaint(displayedPaintPoint(sample, paintPointer));
  });
  on(paintSurface, 'pointerup', event => {
    if (paintPointer?.id === event.pointerId) {
      const point = displayedPaintPoint(event, paintPointer); movePaint(point);
      if (paintPointer.tool === 'line') placeLineAnchor(point, event);
      else finishPaint();
    }
  });
  on(paintSurface, 'dblclick', event => {
    if (event.button === 0 && paintPointer?.tool === 'line' && paintPointer.points.length >= 2) {
      event.preventDefault(); finishPaint();
    }
  });
  for (const type of ['pointercancel', 'lostpointercapture']) on(paintSurface, type, event => {
    if (paintPointer?.id === event.pointerId) finishPaint(true);
  });
  on(paintSurface, 'keydown', event => {
    const size = dimensionsFor(settings);
    paintCursor ??= { pitch: size.low + Math.floor(size.width / 2), beat: Math.min(2, size.heightBeats / 2) };
    const step = event.shiftKey ? 12 : 1, beat = event.shiftKey ? 1 : .25;
    if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) {
      event.preventDefault();
      paintCursor = { pitch: Math.round(bound(paintCursor.pitch + (event.key === 'ArrowLeft' ? -step : event.key === 'ArrowRight' ? step : 0), size.low, size.high)),
        beat: bound(paintCursor.beat + (event.key === 'ArrowUp' ? beat : event.key === 'ArrowDown' ? -beat : 0), 0, size.heightBeats - 1 / PPQ) };
      if (keyboardPaint || paintPointer?.tool === 'line') movePaint(paintCursor);
      inputs('Status').value = `Workbox pitch ${paintCursor.pitch} · time ${Number(paintCursor.beat.toFixed(2))} beats`;
    }
    if (event.key === 'Enter' && !event.repeat) {
      event.preventDefault();
      if (paintPointer?.tool === 'line') placeLineAnchor(paintCursor);
      else { beginPaint(paintCursor); keyboardPaint = paintPointer?.tool !== 'line'; }
    }
    if (event.key === ' ' && paintPointer?.tool === 'line') {
      event.preventDefault();
      if (paintPointer.points.length >= 2) finishPaint();
      else inputs('Status').value = 'Place a second anchor before finishing the line.';
    }
    if (event.key === 'Escape') {
      event.preventDefault(); finishPaint(true); keyboardPaint = false;
      painting = false; rememberWorkbox(); render(); handle.focus({ preventScroll: true });
    }
  });
  on(paintSurface, 'keyup', event => { if (event.key === 'Enter' && keyboardPaint) { event.preventDefault(); keyboardPaint = false; finishPaint(); } });
  on(inputs('ChannelButton'), 'click', () => toggleMenu(channelMenu, inputs('ChannelButton'), inputs('Channel')));
  on(inputs('MathSettings'), 'click', () => onGeneratorSettings?.(source));
  on(inputs('Cancel'), 'click', discard);
  on(document, 'pointerdown', event => {
    // Formula edits keep the preview visible; clicks in the graphic but
    // outside the workbox still tuck an unfinished draft for later.
    // Layers and the independent one-pitch rail can play without tucking a
    // silent draft or changing its drawing tool.
    if (event.target.closest('#blechLayers, .blech-note-rail')) return;
    if (!overlay.hidden && !overlay.contains(event.target)
      && !event.target.closest('.blech-workbench, #blechPlaygroundTools, #blechBrushMenu, #blechStampMenu, #blechLoopStampMenu, #blechWorkboxMathMenu')) tuck();
    else if (![channelMenu, textMenu, addMenu].every(menu => menu.hidden)
      && ![channelMenu, textMenu, addMenu].some(menu => menu.contains(event.target))
      && !event.target.closest('#blechDropChannelButton, [data-stage-text], #blechWorkboxAddToggle')) closeMenus();
  });
  on(document, 'click', event => {
    // Selecting a different frame suspends the draft. Play, Trash and the
    // Layers toggle do not, so a child can keep drawing with the panel open.
    if (!event.target.closest('#blechLayers [data-layer-name], #blechLayers [data-layer-settings]')) return;
    if (shown && !dropped) tuck();
    else closeMenus();
  });
  on(document, 'keydown', event => { if (event.key === 'Escape' && ![channelMenu, textMenu, addMenu].every(menu => menu.hidden)) {
    event.preventDefault(); event.stopPropagation(); closeMenus(true);
  } });
  on(inputs('Channel'), 'input', () => configure({ channel: inputs('Channel').value === '-1' ? null : Number(inputs('Channel').value) }));
  on(inputs('Program'), 'change', () => configure({ program: inputs('Program').value }));
  on(inputs('Gain'), 'input', () => configure({ gain: Number(inputs('Gain').value) / WORKBOX_VOLUME_MAX }));
  on(inputs('Reset'), 'click', () => {
    closeMenus(); shown = true; finishPaint(true);
    if (source === 'math') {
      try {
        const reset = onMathNoteReset?.();
        if (reset) { score = { ...reset, analysis: reset.analysis ?? parseMidi(reset.buffer) }; prepared = null; }
      } catch (error) { inputs('Status').value = error.message || 'Could not reset Math notes.'; return; }
    }
    if (workbox) {
      // Reset a handmade box to an empty canvas without discarding its frame
      // or touching already-playing Layers. Generator formula/file stays put.
      workbox = { low: 40, width: 48, heightBeats: 4, notes: [] };
      workboxText = null; workboxMath = null; inputs('Text').value = ''; inputs('TextFont').value = 'digital'; painting = true; workboxTool = 'draw';
      prepared = null; onWorkboxToolChange?.(workboxTool);
    }
    configure(initialSettings ?? { channel: 0, program: '0', gain: .75, transpose: 0,
      delayBeats: 2, widthNotes: 48, heightBeats: 4, rotationDegrees: 0, loop: false });
    inputs('Status').value = workbox ? 'Empty workbox ready. Draw, stamp or type before Drop.' : 'Workbox frame and sound reset.';
  });
  const dragControls = [handle, ...overlay.querySelectorAll('[data-resize]'), rotate];
  let rotationFrame = null, pendingRotation = null;
  function finishDrag(commit = false) {
    if (rotationFrame !== null) { cancelAnimationFrame(rotationFrame); rotationFrame = null; }
    if (commit && pendingRotation !== null && pendingRotation !== settings.rotationDegrees) configure({ rotationDegrees: pendingRotation });
    pendingRotation = null; pointer = null;
  }
  function resizeBlock(start, dx, dy) {
    const patch = {}, edge = start.edge;
    if (edge.includes('left') || edge.includes('right')) {
      const low = edge.includes('left') ? Math.round(bound(start.low + dx, 0, start.high)) : start.low;
      const high = edge.includes('right') ? Math.round(bound(start.high + dx, start.low, 127)) : start.high;
      patch.widthNotes = high - low + 1;
      patch.transpose = low - dimensionsFor({ ...settings, widthNotes: patch.widthNotes, transpose: 0 }).low;
    }
    if (edge.includes('top') || edge.includes('bottom')) {
      patch.heightBeats = bound(start.heightBeats + (edge.includes('top') ? -dy : dy), .25, 512);
      if (edge.includes('bottom')) {
        patch.heightBeats = Math.min(patch.heightBeats, start.heightBeats + start.delayBeats);
        patch.delayBeats = start.delayBeats + start.heightBeats - patch.heightBeats;
      }
    }
    configure(patch);
  }
  for (const control of dragControls) {
    on(control, 'pointerdown', event => {
      if (event.button !== 0 || !event.isPrimary) return;
      event.preventDefault(); const g = geometry(), dimensions = dimensionsFor(settings);
      const box = handle.getBoundingClientRect(), centerX = box.left + box.width / 2, centerY = box.top + box.height / 2;
      pointer = { id: event.pointerId, x: event.clientX, y: event.clientY, ...settings, ...dimensions,
        low: dimensions.low + (workbox ? 0 : settings.transpose), high: dimensions.high + (workbox ? 0 : settings.transpose),
        edge: control === rotate ? 'rotate' : control.dataset.resize || '', centerX, centerY,
        angle: Math.atan2(centerY - event.clientY, event.clientX - centerX),
        width: g.width, pixelsPerBeat: g.velocity * g.height * 60 / Math.max(1, getTempo()) };
      control.setPointerCapture(event.pointerId); control.focus({ preventScroll: true });
    });
    on(control, 'pointermove', event => {
      if (pointer?.id !== event.pointerId) return;
      const dx = Math.round((event.clientX - pointer.x) / pointer.width * 128), dy = (event.clientY - pointer.y) / pointer.pixelsPerBeat;
      if (pointer.edge === 'rotate') {
        const angle = Math.atan2(pointer.centerY - event.clientY, event.clientX - pointer.centerX);
        const degrees = Math.round(((pointer.rotationDegrees + (angle - pointer.angle) * 180 / Math.PI) % 360 + 360) % 360);
        if (degrees === pendingRotation || degrees === settings.rotationDegrees) return;
        pendingRotation = degrees;
        if (rotationFrame === null) rotationFrame = requestAnimationFrame(() => {
          rotationFrame = null;
          if (pointer?.edge === 'rotate' && pendingRotation !== settings.rotationDegrees) configure({ rotationDegrees: pendingRotation });
        });
      }
      else if (pointer.edge) resizeBlock(pointer, dx, dy);
      else configure({ transpose: pointer.transpose + dx, delayBeats: pointer.delayBeats - dy });
    });
    on(control, 'pointerup', () => finishDrag(true));
    for (const type of ['pointercancel', 'lostpointercapture']) on(control, type, () => finishDrag());
    if (control !== handle) on(control, 'keydown', event => {
      if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) return;
      event.preventDefault();
      const dimensions = dimensionsFor(settings), step = event.shiftKey ? 12 : 1, beat = event.shiftKey ? 1 : .25;
      if (control === rotate) { configure({ rotationDegrees: settings.rotationDegrees + (event.key === 'ArrowLeft' || event.key === 'ArrowDown' ? -step : step) }); return; }
      resizeBlock({ ...settings, ...dimensions, low: dimensions.low + (workbox ? 0 : settings.transpose),
        high: dimensions.high + (workbox ? 0 : settings.transpose), edge: control.dataset.resize },
      event.key === 'ArrowLeft' ? -step : event.key === 'ArrowRight' ? step : 0,
      event.key === 'ArrowUp' ? -beat : event.key === 'ArrowDown' ? beat : 0);
    });
  }
  on(handle, 'keydown', event => {
    const step = event.shiftKey ? 12 : 1, beat = event.shiftKey ? 1 : .25;
    const changes = { ArrowLeft: { transpose: settings.transpose - step }, ArrowRight: { transpose: settings.transpose + step }, ArrowUp: { delayBeats: settings.delayBeats + beat }, ArrowDown: { delayBeats: settings.delayBeats - beat } };
    if (changes[event.key]) { event.preventDefault(); configure(changes[event.key]); }
    if ((event.key === 'Enter' || event.key === ' ') && !workbox) { event.preventDefault(); send(); }
    if (event.key === 'Escape') { event.preventDefault(); tuck(); document.getElementById('blechToolWorkbox')?.focus({ preventScroll: true }); }
  });
  on(globalThis, 'blur', () => { finishDrag(); finishPaint(true); keyboardPaint = false; });
  on(document, 'visibilitychange', () => { if (document.hidden) finishPaint(true); });
  const resize = new ResizeObserver(render);
  resize.observe(viewport);
  for (const node of [viewport.closest('#blechMidi')?.querySelector('.blech-workbench'),
    viewport.closest('#blechMidi')?.querySelector('#blechLayers')]) if (node) resize.observe(node);
  render();
  function startWorkbox({ fresh = false } = {}) {
    if (disposed) return;
    if (!fresh && workbox && source === 'workbox') {
      shown = true; render(); return;
    }
    finishPaint(true);
    if (source !== 'workbox') sourceSettings.set(source, { ...settings });
    if (fresh) savedWorkbox = null;
    workbox = savedWorkbox?.box ?? { low: 40, width: 48, heightBeats: 4, notes: [] };
    settings = savedWorkbox?.settings ?? { channel: 0, program: '0', gain: .75, transpose: 0,
      delayBeats: 2, widthNotes: workbox.width, heightBeats: workbox.heightBeats, rotationDegrees: 0, loop: false };
    initialSettings = savedWorkbox?.initialSettings ?? { channel: 0, program: '0', gain: .75, transpose: 0,
      delayBeats: 2, widthNotes: 48, heightBeats: 4, rotationDegrees: 0, loop: false };
    workboxText = savedWorkbox?.text ?? null; workboxMath = savedWorkbox?.math ?? null;
    source = 'workbox'; draftKey = 'workbox'; name = 'Your workbox'; score = null; prepared = null;
    shown = true; dropped = false; finishDrag(); workboxTool = savedWorkbox?.tool ?? 'draw';
    painting = savedWorkbox?.painting ?? true; paintCursor = null; closeMenus();
    inputs('Status').value = 'Paint notes inside the empty box, or add a prepared shape. Drop when ready.';
    configure({});
  }
  function appendWorkboxShape(next) {
    if (!workbox || source !== 'workbox') return false;
    try {
      const additions = workboxShapeNotes(next, workbox);
      if (!additions.length) throw new Error('Prepare a pattern with notes first.');
      if (workbox.notes.length + additions.length > WORKBOX_NOTE_LIMIT) throw new Error('This workbox holds up to 4,096 notes.');
      workbox = { ...workbox, notes: [...workbox.notes, ...additions] };
      rebuildWorkbox(); render();
      inputs('Status').value = `${workbox.notes.length} notes in the silent workbox. Add more or Drop.`;
      return true;
    } catch (error) { inputs('Status').value = error.message || 'Could not add this pattern.'; return false; }
  }
  function clearWorkbox() {
    if (workbox) discard();
    savedWorkbox = null;
    sourceSettings.delete('workbox');
  }
  return {
    prepare(next, options = {}) {
      rememberWorkbox(); finishPaint(true); workbox = null; painting = false; workboxText = null;
      sourceSettings.set(source, { ...settings });
      const changedSource = source !== (options.source ?? source); source = options.source ?? source; draftKey = options.draftKey ?? null;
      const firstPreparation = changedSource && !sourceSettings.has(source);
      if (changedSource) settings = sourceSettings.get(source) ?? { channel: options.channel ?? (source === 'files' ? null : 0), program: options.program ?? (source === 'files' ? 'original' : '0'), gain: bound(options.gain, 0, 1, .75), transpose: 0, delayBeats: 2, widthNotes: null, heightBeats: null, rotationDegrees: 0, loop: Boolean(options.loop) };
      try { score = next ? { ...next, analysis: next.analysis ?? parseMidi(next.buffer) } : null; } catch (error) { score = null; options = { ...options, error: error.message }; }
      draftError = options.error || '';
      // Typing an incomplete equation should not make its frame disappear.
      // Keep the last valid notes visible but never allow them to be Dropped
      // until the expression is valid again.
      if (source === 'math') {
        if (score && !draftError) mathPreviewScore = score;
        else if (draftError && mathPreviewScore) score = mathPreviewScore;
      }
      if (firstPreparation && source === 'math' && score?.analysis?.notes?.length) {
        // Leave the first equation's grips clear of the desktop options
        // drawer. Reset returns to this approachable first-frame position.
        const size = dropScoreDimensions(score, { widthNotes: 48 });
        settings = { ...settings, widthNotes: size.width, heightBeats: Math.min(4, size.heightBeats),
          transpose: Math.floor((128 - size.width) / 2) - size.low };
      }
      if (!sourceInitialSettings.has(source)) sourceInitialSettings.set(source, { ...settings });
      initialSettings = sourceInitialSettings.get(source);
      prepared = null; finishDrag();
      // When the expression is temporarily invalid, the last valid Math
      // notes stay in the same frame as a non-droppable preview.
      name = options.name || source; shown = Boolean(score); dropped = false; closeMenus(); inputs('Status').value = options.error || '';
      configure({});
    },
    send, configure, refresh: render, startWorkbox, setWorkboxTool, setWorkboxMath, appendWorkboxShape, clearWorkbox,
    closeWorkboxMenu: () => { if (!addMenu.hidden) { closeMenus(); addButton.focus({ preventScroll: true }); } },
    hasWorkbox: () => Boolean(workbox || savedWorkbox),
    attachSourceTool(toolSource, node) { node.dataset.workboxSource = toolSource; sourceTools.append(node); render(); },
    getWorkboxTool: () => workboxTool,
    getSettings: () => ({ ...settings, source, name }), getPreparedScore: () => prepared, getSourceScore: () => score,
    suspendInteractions(suspended = true) { interactionsSuspended = Boolean(suspended); pointer = null; render(); },
    show() { if (prepared || workbox) { shown = true; dropped = false; render(); } },
    hide: tuck, discard,
    dispose() { disposed = true; finishDrag(); finishPaint(true); events.abort(); resize.disconnect(); overlay.remove(); host.replaceChildren(); sourceSettings.clear(); sourceInitialSettings.clear(); savedWorkbox = null; workbox = null; workboxText = null; workboxMath = null; score = null; prepared = null; mathPreviewScore = null; },
  };
}

import { blackMidiKeyLayout, blackMidiTimeGeometry } from './blech-midi-black-renderer.js';
import { GM_PROGRAM_NAMES, parseMidi } from '../midi-mixer/midi-mixer-model.js';
import { midiStampPitchBounds, transformMidiStamp, rotateMidiStamp } from '../midi-mixer/midi-mixer-score-transform.js';

const bound = (value, low, high, fallback = 0) => Math.max(low, Math.min(high, Number.isFinite(Number(value)) ? Number(value) : fallback));

/** Move the complete phrase; never clamp individual notes into a pile at an edge. */
export function constrainDropPosition(notes, { transpose = 0, delayBeats = 2 } = {}) {
  let low = 127, high = 0;
  for (const note of notes) { low = Math.min(low, note.note); high = Math.max(high, note.note); }
  return { transpose: Math.round(bound(transpose, notes.length ? -low : 0, notes.length ? 127 - high : 0)) + 0, delayBeats: Math.round(bound(delayBeats, 0, 64) * 4) / 4 };
}

/** Width is occupied MIDI pitches; height is the full phrase, including its loop boundary. */
export function dropScoreDimensions(score, { widthNotes = null, heightBeats = null, rotationDegrees = 0 } = {}) {
  const analysis = score?.analysis, pitch = midiStampPitchBounds(analysis?.notes ?? [], widthNotes);
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
  const resized = rotation ? rotateMidiStamp(score.buffer, { rotationDegrees: rotation, pitchWidth: settings.widthNotes, heightBeats: settings.heightBeats })
    : transformMidiStamp(score.buffer, { pitchWidth: dimensions.width, timeScale: dimensions.timeScale });
  return { ...score, ...resized, notes: resized.analysis.notes, durationBeats: resized.analysis.durationBeats, duration: resized.analysis.durationSeconds };
}

/** Silent preparation over the same pitch/time coordinates as the live renderer. */
export function mountBlechDropStage(host, viewport, { getTempo = () => 120, getView = () => ({}), onDrop, onStop, onSettings } = {}) {
  const events = new AbortController(), on = (node, type, fn) => node.addEventListener(type, fn, { signal: events.signal });
  host.innerHTML = `<div class="blech-drop-heading"><b>Send Drop</b><output id="blechDropName">Choose or prepare a pattern</output></div>
    <div class="blech-drop-transport"><button id="blechDropSend" data-primary-transport type="button" disabled>Drop ↓</button><div role="group" aria-label="Drop playback"><button id="blechDropOnce" type="button" aria-pressed="true" title="Play once">1</button><button id="blechDropLoop" type="button" aria-pressed="false">Loop</button></div><button id="blechDropStop" type="button" title="Stop layers from this generator">Stop</button></div>
    <div class="blech-drop-sound"><label>Channel<select id="blechDropChannel" aria-label="Drop MIDI channel"><option value="">Original</option>${Array.from({ length: 16 }, (_, i) => `<option value="${i}">${i + 1}${i === 9 ? ' · drums' : ''}</option>`).join('')}</select></label><label>Instrument<select id="blechDropProgram" aria-label="Drop instrument"><option value="original">Original</option>${GM_PROGRAM_NAMES.map((name, i) => `<option value="${i}">${i + 1}. ${name}</option>`).join('')}</select></label><label class="control"><span><b>Volume</b><output id="blechDropGainOut">75%</output></span><input id="blechDropGain" aria-label="Drop volume" type="range" min="0" max="1" step=".01" value=".75"></label></div>
    <div class="blech-drop-position"><label>Pitch ↔<input id="blechDropPitch" aria-label="Drop pitch offset" type="number" min="-127" max="127" step="1" value="0"></label><label>Delay ↑ · beats<input id="blechDropDelay" aria-label="Drop delay in beats" type="number" min="0" max="64" step=".25" value="2"></label><label>Width · notes<input id="blechDropWidth" aria-label="Drop width in notes" type="number" min="1" max="128" step="1"></label><label>Height · beats<input id="blechDropHeight" aria-label="Drop height in beats" type="number" min=".25" max="512" step=".25"></label><label>Rotate · °<input id="blechDropRotation" aria-label="Drop rotation in degrees" type="number" min="0" max="359" step="1" value="0"></label><button id="blechDropReset" type="button">Reset block</button></div><output id="blechDropStatus" role="status"></output>`;
  const $ = id => host.querySelector(`#blechDrop${id}`);
  const overlay = document.createElement('div'); overlay.className = 'blech-drop-overlay'; overlay.hidden = true;
  overlay.innerHTML = `<canvas aria-label="Prepared MIDI notes"></canvas><button class="blech-drop-handle" type="button" aria-label="Move prepared MIDI: left and right change pitch, up and down change delay" data-space-key-owner></button>${['left', 'right', 'top', 'bottom', 'top-left', 'top-right', 'bottom-left', 'bottom-right'].map(edge => `<button class="blech-drop-resize" data-resize="${edge}" type="button" aria-label="Resize prepared MIDI ${edge.replace('-', ' ')} edge" title="Resize ${edge.replace('-', ' ')} · arrow keys adjust" data-space-key-owner></button>`).join('')}<div class="blech-drop-floating"><span>Prepared</span><button type="button" data-stage-loop aria-pressed="false">Loop</button><button type="button" data-stage-send>Drop ↓</button><button type="button" data-stage-hide aria-label="Hide prepared preview">×</button></div>`;
  viewport.append(overlay);
  const canvas = overlay.querySelector('canvas'), ctx = canvas.getContext('2d'), handle = overlay.querySelector('.blech-drop-handle'), floating = overlay.querySelector('.blech-drop-floating');
  let score = null, prepared = null, source = 'files', name = '', disposed = false, pointer = null, shown = true, interactionsSuspended = false;
  let settings = { channel: null, program: 'original', gain: .75, transpose: 0, delayBeats: 2, widthNotes: null, heightBeats: null, rotationDegrees: 0, loop: false };
  const sourceSettings = new Map();
  function geometry() { const rect = viewport.getBoundingClientRect(); return { width: rect.width, height: rect.height, ...blackMidiTimeGeometry(getView(), rect.height) }; }
  function render() {
    if (disposed) return;
    const notes = prepared?.analysis?.notes ?? [];
    const dimensions = dropScoreDimensions(score, settings);
    overlay.hidden = !notes.length || !shown || interactionsSuspended;
    $('Send').disabled = !notes.length;
    $('Name').value = name || 'Choose or prepare a pattern';
    for (const [key, id] of [['transpose', 'Pitch'], ['delayBeats', 'Delay'], ['gain', 'Gain'], ['program', 'Program'], ['rotationDegrees', 'Rotation']]) if (document.activeElement !== $(id)) $(id).value = String(settings[key]);
    for (const [id, value] of [['Width', dimensions.width], ['Height', dimensions.heightBeats]]) if (document.activeElement !== $(id)) $(id).value = String(Number(value.toFixed(4)));
    $('Width').disabled = !notes.length || dimensions.sourceWidth === 1 && !settings.rotationDegrees; $('Height').disabled = !notes.length;
    $('Height').max = String(Math.max(512, dimensions.heightBeats));
    $('Height').min = String(Math.min(.25, dimensions.heightBeats));
    $('Channel').value = settings.channel === null ? '' : String(settings.channel);
    $('GainOut').value = `${Math.round(settings.gain * 100)}%`;
    $('Once').setAttribute('aria-pressed', String(!settings.loop)); $('Loop').setAttribute('aria-pressed', String(settings.loop));
    overlay.querySelector('[data-stage-loop]').setAttribute('aria-pressed', String(settings.loop));
    overlay.dataset.source = source; overlay.dataset.transpose = String(settings.transpose); overlay.dataset.delayBeats = String(settings.delayBeats); overlay.dataset.widthNotes = String(dimensions.width); overlay.dataset.heightBeats = String(dimensions.heightBeats); overlay.dataset.rotationDegrees = String(settings.rotationDegrees);
    if (overlay.hidden) return;
    const g = geometry(); if (!g.width || !g.height) return;
    const dpr = Math.min(globalThis.devicePixelRatio || 1, 2);
    canvas.width = Math.round(g.width * dpr); canvas.height = Math.round(g.height * dpr); ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const layout = blackMidiKeyLayout(getView().alignment), secondsPerBeat = 60 / Math.max(1, getTempo()), scale = g.velocity * g.height * secondsPerBeat, present = g.keyboardTop * g.height;
    const lowKey = layout[dimensions.low + settings.transpose], highKey = layout[dimensions.high + settings.transpose];
    let left = lowKey.x * g.width, right = (highKey.x + highKey.width) * g.width, top = present - (settings.delayBeats + dimensions.heightBeats) * scale, bottom = present - settings.delayBeats * scale;
    ctx.fillStyle = '#b4ffe3';
    // Preview is bounded independently of the audible score. Sending retains every note.
    const stride = Math.max(1, Math.ceil(notes.length / 8192));
    for (let i = 0; i < notes.length; i += stride) {
      const n = notes[i], key = layout[n.note + settings.transpose]; if (!key) continue;
      const x = key.x * g.width, w = Math.max(1, key.width * g.width), y = present - (settings.delayBeats + n.beat + n.duration) * scale, b = present - (settings.delayBeats + n.beat) * scale;
      if (b < 0 || y > present) continue;
      ctx.globalAlpha = .6; ctx.fillRect(x, Math.max(0, y), w, Math.max(1, Math.min(present, b) - Math.max(0, y)));
    }
    ctx.globalAlpha = 1;
    left = bound(left - 4, 0, Math.max(0, g.width - 32)); right = bound(right + 4, left + 32, g.width);
    top = bound(top - 4, 0, Math.max(0, present - 32)); bottom = bound(bottom + 4, top + 32, present);
    Object.assign(handle.style, { left: `${left}px`, top: `${top}px`, width: `${right - left}px`, height: `${bottom - top}px` });
    for (const grip of overlay.querySelectorAll('[data-resize]')) {
      const edge = grip.dataset.resize, x = edge.includes('left') ? left : edge.includes('right') ? right : (left + right) / 2, y = edge.includes('top') ? top : edge.includes('bottom') ? bottom : (top + bottom) / 2;
      Object.assign(grip.style, { left: `${x}px`, top: `${y}px` });
      grip.disabled = (edge === 'left' || edge === 'right') && dimensions.sourceWidth === 1 && !settings.rotationDegrees;
    }
    Object.assign(floating.style, { left: `${bound(left, 0, Math.max(0, g.width - 250))}px`, top: `${Math.max(0, top - 32)}px` });
    floating.querySelector('span').textContent = `${dimensions.width} notes × ${Number(dimensions.heightBeats.toFixed(2))} beats`;
  }
  function configure(patch) {
    const next = { ...settings, ...patch };
    next.rotationDegrees = ((Number(next.rotationDegrees) || 0) % 360 + 360) % 360;
    try {
      const dimensions = dropScoreDimensions(score, next);
      if (next.widthNotes !== null) next.widthNotes = dimensions.width;
      if (next.heightBeats !== null) next.heightBeats = dimensions.heightBeats;
      if (!prepared || next.widthNotes !== settings.widthNotes || next.heightBeats !== settings.heightBeats || next.rotationDegrees !== settings.rotationDegrees) prepared = resizeDropScore(score, next);
      settings = { ...next, ...constrainDropPosition(prepared ? [{ note: dimensions.low }, { note: dimensions.high }] : [], next) };
      sourceSettings.set(source, { ...settings }); render(); onSettings?.({ ...settings, source });
    } catch (error) { render(); $('Status').value = error.message; }
  }
  function send() {
    if (!prepared?.analysis?.notes.length || disposed) return null;
    try {
      const sent = onDrop?.(prepared, { ...settings, source, name, quantize: false });
      if (!sent) return null;
      shown = false; $('Status').value = `${name} sent${settings.loop ? ' · looping' : ' · one shot'}`; render(); return sent;
    } catch (error) { $('Status').value = error.message; return null; }
  }
  on($('Send'), 'click', send); on(overlay.querySelector('[data-stage-send]'), 'click', send);
  on($('Stop'), 'click', () => onStop?.(source));
  on($('Once'), 'click', () => configure({ loop: false })); on($('Loop'), 'click', () => configure({ loop: true }));
  on(overlay.querySelector('[data-stage-loop]'), 'click', () => configure({ loop: !settings.loop }));
  on(overlay.querySelector('[data-stage-hide]'), 'click', () => { shown = false; render(); });
  on($('Channel'), 'change', () => configure({ channel: $('Channel').value === '' ? null : Number($('Channel').value) }));
  on($('Program'), 'change', () => configure({ program: $('Program').value }));
  on($('Gain'), 'input', () => configure({ gain: Number($('Gain').value) }));
  on($('Pitch'), 'change', () => { shown = true; configure({ transpose: Number($('Pitch').value) }); });
  on($('Delay'), 'change', () => { shown = true; configure({ delayBeats: Number($('Delay').value) }); });
  on($('Width'), 'change', () => { shown = true; configure({ widthNotes: Number($('Width').value) }); $('Width').value = String(dropScoreDimensions(score, settings).width); });
  on($('Height'), 'change', () => { shown = true; configure({ heightBeats: Number($('Height').value) }); $('Height').value = String(dropScoreDimensions(score, settings).heightBeats); });
  on($('Rotation'), 'change', () => { shown = true; configure({ rotationDegrees: Number($('Rotation').value) }); $('Rotation').value = String(settings.rotationDegrees); });
  on($('Reset'), 'click', () => { shown = true; configure({ transpose: 0, delayBeats: 2, widthNotes: null, heightBeats: null, rotationDegrees: 0 }); });
  const dragControls = [handle, ...overlay.querySelectorAll('[data-resize]')];
  function resizeBlock(start, dx, dy) {
    const patch = {}, edge = start.edge;
    if (edge.includes('left') || edge.includes('right')) {
      const low = edge.includes('left') ? Math.round(bound(start.low + dx, 0, start.high)) : start.low;
      const high = edge.includes('right') ? Math.round(bound(start.high + dx, start.low, 127)) : start.high;
      patch.widthNotes = high - low + 1;
      patch.transpose = low - dropScoreDimensions(score, { ...settings, widthNotes: patch.widthNotes }).low;
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
      event.preventDefault(); const g = geometry(), dimensions = dropScoreDimensions(score, settings);
      pointer = { id: event.pointerId, x: event.clientX, y: event.clientY, ...settings, ...dimensions, low: dimensions.low + settings.transpose, high: dimensions.high + settings.transpose, edge: control.dataset.resize || '', width: g.width, pixelsPerBeat: g.velocity * g.height * 60 / Math.max(1, getTempo()) };
      control.setPointerCapture(event.pointerId); control.focus({ preventScroll: true });
    });
    on(control, 'pointermove', event => {
      if (pointer?.id !== event.pointerId) return;
      const dx = Math.round((event.clientX - pointer.x) / pointer.width * 128), dy = (event.clientY - pointer.y) / pointer.pixelsPerBeat;
      if (pointer.edge) resizeBlock(pointer, dx, dy);
      else configure({ transpose: pointer.transpose + dx, delayBeats: pointer.delayBeats - dy });
    });
    for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) on(control, type, () => { pointer = null; });
    if (control !== handle) on(control, 'keydown', event => {
      if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) return;
      event.preventDefault();
      const dimensions = dropScoreDimensions(score, settings), step = event.shiftKey ? 12 : 1, beat = event.shiftKey ? 1 : .25;
      resizeBlock({ ...settings, ...dimensions, low: dimensions.low + settings.transpose, high: dimensions.high + settings.transpose, edge: control.dataset.resize }, event.key === 'ArrowLeft' ? -step : event.key === 'ArrowRight' ? step : 0, event.key === 'ArrowUp' ? -beat : event.key === 'ArrowDown' ? beat : 0);
    });
  }
  on(handle, 'keydown', event => {
    const step = event.shiftKey ? 12 : 1, beat = event.shiftKey ? 1 : .25;
    const changes = { ArrowLeft: { transpose: settings.transpose - step }, ArrowRight: { transpose: settings.transpose + step }, ArrowUp: { delayBeats: settings.delayBeats + beat }, ArrowDown: { delayBeats: settings.delayBeats - beat } };
    if (changes[event.key]) { event.preventDefault(); configure(changes[event.key]); }
    if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); send(); }
    if (event.key === 'Escape') { event.preventDefault(); shown = false; render(); $('Send').focus(); }
  });
  on(globalThis, 'blur', () => { pointer = null; });
  const resize = new ResizeObserver(render); resize.observe(viewport); render();
  return {
    prepare(next, options = {}) {
      sourceSettings.set(source, { ...settings });
      const changedSource = source !== (options.source ?? source); source = options.source ?? source;
      if (changedSource) settings = sourceSettings.get(source) ?? { channel: options.channel ?? (source === 'files' ? null : 0), program: options.program ?? (source === 'files' ? 'original' : '0'), gain: bound(options.gain, 0, 1, .75), transpose: 0, delayBeats: 2, widthNotes: null, heightBeats: null, rotationDegrees: 0, loop: Boolean(options.loop) };
      try { score = next ? { ...next, analysis: next.analysis ?? parseMidi(next.buffer) } : null; } catch (error) { score = null; options = { ...options, error: error.message }; }
      prepared = null; pointer = null;
      name = options.name || source; shown = Boolean(next); $('Status').value = options.error || '';
      configure({});
    },
    send, configure, refresh: render, getSettings: () => ({ ...settings, source, name }), getPreparedScore: () => prepared, getSourceScore: () => score,
    suspendInteractions(suspended = true) { interactionsSuspended = Boolean(suspended); pointer = null; render(); },
    hide() { shown = false; render(); },
    dispose() { disposed = true; pointer = null; events.abort(); resize.disconnect(); overlay.remove(); host.replaceChildren(); sourceSettings.clear(); score = null; prepared = null; },
  };
}

import { blackMidiKeyLayout, blackMidiTimeGeometry } from './blech-midi-black-renderer.js';
import { GM_PROGRAM_NAMES, parseMidi } from '../midi-mixer/midi-mixer-model.js';

const bound = (value, low, high, fallback = 0) => Math.max(low, Math.min(high, Number.isFinite(Number(value)) ? Number(value) : fallback));

/** Move the complete phrase; never clamp individual notes into a pile at an edge. */
export function constrainDropPosition(notes, { transpose = 0, delayBeats = 2 } = {}) {
  let low = 127, high = 0;
  for (const note of notes) { low = Math.min(low, note.note); high = Math.max(high, note.note); }
  return { transpose: Math.round(bound(transpose, notes.length ? -low : 0, notes.length ? 127 - high : 0)) + 0, delayBeats: Math.round(bound(delayBeats, 0, 64) * 4) / 4 };
}

/** Silent preparation over the same pitch/time coordinates as the live renderer. */
export function mountBlechDropStage(host, viewport, { getTempo = () => 120, getView = () => ({}), onDrop, onStop, onSettings } = {}) {
  const events = new AbortController(), on = (node, type, fn) => node.addEventListener(type, fn, { signal: events.signal });
  host.innerHTML = `<div class="blech-drop-heading"><b>Send Drop</b><output id="blechDropName">Choose or prepare a pattern</output></div>
    <div class="blech-drop-transport"><button id="blechDropSend" data-primary-transport type="button" disabled>Drop ↓</button><div role="group" aria-label="Drop playback"><button id="blechDropOnce" type="button" aria-pressed="true" title="Play once">1</button><button id="blechDropLoop" type="button" aria-pressed="false">Loop</button></div><button id="blechDropStop" type="button" title="Stop layers from this generator">Stop</button></div>
    <div class="blech-drop-sound"><label>Channel<select id="blechDropChannel" aria-label="Drop MIDI channel"><option value="">Original</option>${Array.from({ length: 16 }, (_, i) => `<option value="${i}">${i + 1}${i === 9 ? ' · drums' : ''}</option>`).join('')}</select></label><label>Instrument<select id="blechDropProgram" aria-label="Drop instrument"><option value="original">Original</option>${GM_PROGRAM_NAMES.map((name, i) => `<option value="${i}">${i + 1}. ${name}</option>`).join('')}</select></label><label class="control"><span><b>Volume</b><output id="blechDropGainOut">75%</output></span><input id="blechDropGain" aria-label="Drop volume" type="range" min="0" max="1" step=".01" value=".75"></label></div>
    <div class="blech-drop-position"><label>Pitch ↔<input id="blechDropPitch" aria-label="Drop pitch offset" type="number" min="-127" max="127" step="1" value="0"></label><label>Delay ↑ · beats<input id="blechDropDelay" aria-label="Drop delay in beats" type="number" min="0" max="64" step=".25" value="2"></label><button id="blechDropReset" type="button">Reset position</button></div><output id="blechDropStatus" role="status"></output>`;
  const $ = id => host.querySelector(`#blechDrop${id}`);
  const overlay = document.createElement('div'); overlay.className = 'blech-drop-overlay'; overlay.hidden = true;
  overlay.innerHTML = `<canvas aria-label="Prepared MIDI notes"></canvas><button class="blech-drop-handle" type="button" aria-label="Move prepared MIDI: left and right change pitch, up and down change delay" data-space-key-owner></button><div class="blech-drop-floating"><span>Prepared</span><button type="button" data-stage-loop aria-pressed="false">Loop</button><button type="button" data-stage-send>Drop ↓</button><button type="button" data-stage-hide aria-label="Hide prepared preview">×</button></div>`;
  viewport.append(overlay);
  const canvas = overlay.querySelector('canvas'), ctx = canvas.getContext('2d'), handle = overlay.querySelector('.blech-drop-handle'), floating = overlay.querySelector('.blech-drop-floating');
  let score = null, source = 'files', name = '', disposed = false, pointer = null, shown = true;
  let settings = { channel: null, program: 'original', gain: .75, transpose: 0, delayBeats: 2, loop: false };
  const sourceSettings = new Map();
  function geometry() { const rect = viewport.getBoundingClientRect(); return { width: rect.width, height: rect.height, ...blackMidiTimeGeometry(getView(), rect.height) }; }
  function render() {
    if (disposed) return;
    const notes = score?.analysis?.notes ?? [];
    overlay.hidden = !notes.length || !shown;
    $('Send').disabled = !notes.length;
    $('Name').value = name || 'Choose or prepare a pattern';
    for (const [key, id] of [['transpose', 'Pitch'], ['delayBeats', 'Delay'], ['gain', 'Gain'], ['program', 'Program']]) if (document.activeElement !== $(id)) $(id).value = String(settings[key]);
    $('Channel').value = settings.channel === null ? '' : String(settings.channel);
    $('GainOut').value = `${Math.round(settings.gain * 100)}%`;
    $('Once').setAttribute('aria-pressed', String(!settings.loop)); $('Loop').setAttribute('aria-pressed', String(settings.loop));
    overlay.querySelector('[data-stage-loop]').setAttribute('aria-pressed', String(settings.loop));
    overlay.dataset.source = source; overlay.dataset.transpose = String(settings.transpose); overlay.dataset.delayBeats = String(settings.delayBeats);
    if (overlay.hidden) return;
    const g = geometry(); if (!g.width || !g.height) return;
    const dpr = Math.min(globalThis.devicePixelRatio || 1, 2);
    canvas.width = Math.round(g.width * dpr); canvas.height = Math.round(g.height * dpr); ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const layout = blackMidiKeyLayout(getView().alignment), secondsPerBeat = 60 / Math.max(1, getTempo()), scale = g.velocity * g.height * secondsPerBeat, present = g.keyboardTop * g.height;
    let left = g.width, right = 0, top = present, bottom = 0;
    ctx.fillStyle = '#b4ffe3';
    // Preview is bounded independently of the audible score. Sending retains every note.
    const stride = Math.max(1, Math.ceil(notes.length / 8192));
    for (let i = 0; i < notes.length; i += stride) {
      const n = notes[i], key = layout[n.note + settings.transpose]; if (!key) continue;
      const x = key.x * g.width, w = Math.max(1, key.width * g.width), y = present - (settings.delayBeats + n.beat + n.duration) * scale, b = present - (settings.delayBeats + n.beat) * scale;
      left = Math.min(left, x); right = Math.max(right, x + w); top = Math.min(top, y); bottom = Math.max(bottom, b);
      if (b < 0 || y > present) continue;
      ctx.globalAlpha = .6; ctx.fillRect(x, Math.max(0, y), w, Math.max(1, Math.min(present, b) - Math.max(0, y)));
    }
    ctx.globalAlpha = 1;
    left = bound(left - 4, 0, Math.max(0, g.width - 32)); right = bound(right + 4, left + 32, g.width);
    top = bound(top - 4, 0, Math.max(0, present - 32)); bottom = bound(bottom + 4, top + 32, present);
    Object.assign(handle.style, { left: `${left}px`, top: `${top}px`, width: `${right - left}px`, height: `${bottom - top}px` });
    Object.assign(floating.style, { left: `${bound(left, 0, Math.max(0, g.width - 250))}px`, top: `${Math.max(0, top - 32)}px` });
    floating.querySelector('span').textContent = `${settings.transpose >= 0 ? '+' : ''}${settings.transpose} · ${settings.delayBeats} beats`;
  }
  function configure(patch) {
    settings = { ...settings, ...patch, ...constrainDropPosition(score?.analysis?.notes ?? [], { ...settings, ...patch }) };
    sourceSettings.set(source, { ...settings }); render(); onSettings?.({ ...settings, source });
  }
  function send() {
    if (!score?.analysis?.notes.length || disposed) return null;
    try {
      const sent = onDrop?.(score, { ...settings, source, name, quantize: false });
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
  on($('Reset'), 'click', () => { shown = true; configure({ transpose: 0, delayBeats: 2 }); });
  on(handle, 'pointerdown', event => {
    if (event.button !== 0 || !event.isPrimary) return;
    event.preventDefault(); const g = geometry();
    pointer = { id: event.pointerId, x: event.clientX, y: event.clientY, ...settings, width: g.width, pixelsPerBeat: g.velocity * g.height * 60 / Math.max(1, getTempo()) };
    handle.setPointerCapture(event.pointerId); handle.focus({ preventScroll: true });
  });
  on(handle, 'pointermove', event => {
    if (pointer?.id !== event.pointerId) return;
    configure({ transpose: pointer.transpose + Math.round((event.clientX - pointer.x) / pointer.width * 128), delayBeats: pointer.delayBeats - (event.clientY - pointer.y) / pointer.pixelsPerBeat });
  });
  for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) on(handle, type, () => { pointer = null; });
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
      if (changedSource) settings = sourceSettings.get(source) ?? { channel: options.channel ?? (source === 'files' ? null : 0), program: options.program ?? (source === 'files' ? 'original' : '0'), gain: bound(options.gain, 0, 1, .75), transpose: 0, delayBeats: 2, loop: Boolean(options.loop) };
      try { score = next ? { ...next, analysis: next.analysis ?? parseMidi(next.buffer) } : null; } catch (error) { score = null; options = { ...options, error: error.message }; }
      name = options.name || source; shown = Boolean(next); $('Status').value = options.error || '';
      configure({});
    },
    send, configure, refresh: render, getSettings: () => ({ ...settings, source, name }), getPreparedScore: () => score,
    hide() { shown = false; render(); },
    dispose() { disposed = true; pointer = null; events.abort(); resize.disconnect(); overlay.remove(); host.replaceChildren(); sourceSettings.clear(); score = null; },
  };
}

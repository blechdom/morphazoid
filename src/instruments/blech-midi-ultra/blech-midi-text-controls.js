import { MAX_TEXT_MIDI_GLYPHS, generateGridMidi, generateLaidOutTextMidi, textMidiGlyphColumns } from '../midiphoria/midiphoria-text-midi.js';
import { parseMidi } from '../midi-mixer/midi-mixer-model.js';
import { mountMixerKnobs } from '../midi-mixer/midi-mixer-knobs.js';
import { drawGeneratorPreview, generatorRange } from './blech-midi-generator-preview.js';
import { spigotGeometry, spigotPoint } from './blech-midi-spigots.js';
import { generateUltraTextMidi, ULTRA_TEXT_FONTS, ultraNoteGlyph, ultraTextFontId, ultraTextGlyphColumns } from './blech-midi-text-fonts.js';

/** Draft geometry never mutates a performing layer until Apply or Drop. */
export function mountBlechText(host, { onDrop, onApply, onPrepare, getLayer = () => null, getTempo = () => 120, getProgram = () => '0' } = {}) {
  const events = new AbortController(), on = (node, type, fn) => node.addEventListener(type, fn, { signal: events.signal });
  host.innerHTML = `<form class="blech-generator blech-text">
    <div class="blech-text-editing" id="blechTextEditing" hidden><output id="blechTextEditingName"></output><button id="blechTextDone" type="button">Done editing</button></div>
    <label class="blech-text-message" for="blechTextMessage">Write text
      <textarea id="blechTextMessage" rows="3" maxlength="128" placeholder="Write a word, message or symbol…&#10;HELLO ❤" autocomplete="off" spellcheck="false" aria-describedby="blechTextHint">BLECH</textarea>
    </label>
    <div class="blech-generator-toolbar blech-text-actions"><button id="blechTextApply" type="button" hidden>Apply next loop</button><button id="blechTextDrop" type="submit">Drop text</button>
      <button id="blechTextClear" type="button">Clear text</button><label class="blech-generator-check"><input id="blechTextLoop" type="checkbox">Loop new text</label>
    </div>
    <output id="blechTextStatus" role="status"></output>
    <p id="blechTextHint" class="blech-generator-hint">Enter starts a new line. Up to 32 characters, including ❤ ⭐ 🙂.</p>
    <div class="blech-generator-toolbar"><label for="blechTextFont">Font
      <select id="blechTextFont">${ULTRA_TEXT_FONTS.map(({ id, label }) => `<option value="${id}">${label}</option>`).join('')}</select>
    </label><label for="blechTextMode">Arrange
      <select id="blechTextMode"><option value="word">Rows of text</option><option value="letter">Letters in sequence</option></select>
    </label><label class="blech-generator-check"><input id="blechTextFit" type="checkbox" checked>Fit whole pixels</label>
    <fieldset class="blech-text-align"><legend>Align</legend><label><input type="radio" name="blechTextAlign" value="left">Left</label><label><input type="radio" name="blechTextAlign" value="center" checked>Center</label><label><input type="radio" name="blechTextAlign" value="right">Right</label></fieldset></div>
    <div class="blech-text-layout"><span id="blechTextLayoutHint" class="blech-generator-hint"></span><ol id="blechTextLines" aria-label="Line order, first played first"></ol></div>
    <figure class="blech-text-preview"><canvas id="blechTextPreview" width="800" height="256" aria-label="Prepared text notes: selected pitches left to right, first line at the bottom">A preview of the message as MIDI notes.</canvas>
      <figcaption><span>Selected low pitches ← → high pitches</span><span>First line plays from the bottom</span></figcaption>
    </figure>
    <output id="blechTextStatistics"></output>
    <div class="blech-generator-controls blech-text-size">
      ${generatorRange('blechText', 'Beats', 'Total duration', .25, 64, .25, 8)}
      ${generatorRange('blechText', 'Span', 'Keyboard width', 12, 128, 1, 48)}
      <div id="blechTextScaleControl">${generatorRange('blechText', 'Scale', 'Letter size', 1, 4, 1, 1)}</div>
    </div>
    <label class="blech-text-position" for="blechTextPosition"><span>Keyboard position <output id="blechTextPositionOut"></output></span>
      <input id="blechTextPosition" type="range" min="0" max="80" step="1" value="40" data-keep-slider aria-describedby="blechTextPositionOut">
    </label>
    <p class="blech-generator-hint">Width sets the pitch window; duration sets the time for all lines. Drop adds a layer. Clear only clears this draft.</p>
  </form>`;
  const $ = key => host.querySelector(`#blechText${key}`), form = host.querySelector('form');
  let disposed = false, queued = null, score = null, editingId = null, knobs;
  const render = () => { if (!disposed) drawGeneratorPreview($('Preview'), score?.analysis,
    { grid: false, pitchWindow: score && { low: score.layout.lowestNote, span: score.layout.span } }); };
  const format = value => Number(value.toFixed(2));
  const label = prepared => `Text · ${prepared.text.replace(/\n/g, ' / ')}`;
  const dropSettings = () => ({ name: score ? label(score) : 'Text', program: getProgram(), loop: $('Loop').checked });
  function refreshTempo() {
    const beats = Number($('Beats').value), seconds = beats * 60 / getTempo();
    $('BeatsOut').value = `${beats} beats · ${format(seconds)} s`;
  }
  function refresh() {
    if (disposed) return;
    const editing = editingId !== null, layer = editing ? getLayer(editingId) : null;
    $('Editing').hidden = $('Apply').hidden = !editing;
    const title = !editing ? '' : layer ? `Editing ${layer.name}${layer.pendingReplacement ? ' · update queued' : ''}` : 'Layer stopped — drop a new copy to play it.';
    if ($('EditingName').value !== title) $('EditingName').value = title;
    const action = layer?.paused || layer?.pending ? 'Apply changes' : layer?.loop ? 'Apply next loop' : 'Restart this layer';
    if ($('Apply').textContent !== action) $('Apply').textContent = action;
    $('Apply').disabled = !score || !layer;
    $('Drop').textContent = editing ? 'Drop new text' : 'Drop text';
  }
  function update(notify = true) {
    if (disposed) return;
    const span = Number($('Span').value), position = $('Position'), maximum = 128 - span;
    position.max = String(maximum); position.value = String(Math.min(Number(position.value), maximum));
    position.disabled = maximum === 0;
    const low = Number(position.value), range = `MIDI ${low}–${low + span - 1}`;
    $('PositionOut').value = maximum === 0 ? `Full keyboard · ${range}` : range;
    position.setAttribute('aria-valuetext', $('PositionOut').value);
    $('SpanOut').value = `${span} keys`; refreshTempo();
    $('ScaleControl').hidden = $('Fit').checked;
    score = null; $('Status').value = ''; $('Lines').replaceChildren();
    $('LayoutHint').textContent = 'Prepared lines · first played first';
    try {
      const settings = { message: $('Message').value, mode: $('Mode').value, span, lowestNote: low,
        beats: Number($('Beats').value), fit: $('Fit').checked, scale: Number($('Scale').value), font: $('Font').value,
        align: host.querySelector('[name="blechTextAlign"]:checked').value };
      score = generateUltraTextMidi(settings.message, settings);
      score.analysis = parseMidi(score.buffer);
      score.textSettings = { ...settings, scale: score.layout.scale };
      $('Scale').value = String(score.layout.scale); knobs?.update($('Scale'));
      $('ScaleOut').value = `${score.layout.glyphWidth} keys / letter`;
      $('LayoutHint').textContent = `${score.lines.length} prepared line${score.lines.length === 1 ? '' : 's'} · ${score.layout.capacity} characters fit · first played first`;
      for (const line of score.lines) {
        const item = document.createElement('li'), text = document.createElement('span'), reason = document.createElement('small');
        text.textContent = line.text || '(blank line)'; reason.textContent = ({ explicit: 'Enter', wrap: 'wrap', 'hard-wrap': 'word split', letter: 'next letter', end: '' })[line.breakReason] ?? '';
        item.append(text, reason); $('Lines').append(item);
      }
      $('Statistics').value = `${score.analysis.noteCount.toLocaleString()} notes · ${score.lines.length} line${score.lines.length === 1 ? '' : 's'}`;
      $('Status').value = [score.truncated ? 'Showing the first 32 characters.' : '', score.unsupported.length ? `Skipped unsupported symbols: ${score.unsupported.join(' ')}` : ''].filter(Boolean).join(' ');
    } catch (error) {
      score = null; $('Statistics').value = ''; $('ScaleOut').value = `${Number($('Scale').value) * ultraTextGlyphColumns($('Font').value)} keys / letter`;
      $('Status').value = $('Message').value.trim() ? error.message : 'Type a message to prepare its notes.';
    }
    $('Drop').disabled = !score; refresh(); render();
    if (notify && onPrepare) onPrepare({ score: score ? structuredClone(score) : null, settings: dropSettings(), error: score ? '' : $('Status').value });
  }
  function queue() { if (queued === null) queued = requestAnimationFrame(() => { queued = null; update(); }); }
  function flush(notify = true) { if (queued !== null) { cancelAnimationFrame(queued); queued = null; } update(notify); }
  function getScore() { flush(false); if (!score) throw new Error($('Status').value); return structuredClone(score); }
  function getSettings() { flush(false); return dropSettings(); }
  for (const key of ['Message', 'Span', 'Beats', 'Position', 'Scale']) on($(key), 'input', queue);
  for (const key of ['Font', 'Mode', 'Fit']) on($(key), 'change', queue);
  on($('Loop'), 'change', queue);
  for (const radio of host.querySelectorAll('[name="blechTextAlign"]')) on(radio, 'change', queue);
  on($('Clear'), 'click', () => { $('Message').value = ''; flush(); $('Message').focus(); });
  on($('Done'), 'click', () => { editingId = null; refresh(); $('Status').value = ''; });
  on(form, 'submit', async event => {
    event.preventDefault(); flush(); if (!score) return;
    const prepared = score;
    try {
      await onDrop?.(prepared, dropSettings());
      if (!disposed) $('Status').value = 'Text added to Layers. Pause, stop or edit it there.';
    } catch (error) { if (!disposed) $('Status').value = error.message; }
  });
  on($('Apply'), 'click', async () => {
    flush(); const layer = getLayer(editingId); if (!score || !layer) return;
    const when = !layer.loop && !layer.pending && !layer.paused ? 'restart' : 'next-loop';
    try {
      const result = await onApply?.(editingId, score, { name: label(score), when });
      if (disposed) return;
      if (!result) throw new Error('This layer has stopped. Drop a new copy to play it.');
      $('Status').value = result.pendingReplacement ? 'Update queued for the next loop. Apply again to replace that update.' : result.paused ? 'Prepared layer updated; it stays paused.' : 'Text layer updated.';
      refresh();
    } catch (error) { if (!disposed) $('Status').value = error.message; }
  });
  const resize = new ResizeObserver(render); resize.observe($('Preview'));
  update(); knobs = mountMixerKnobs(host);
  return { getScore, getSettings, refreshTempo, refresh, edit({ sampleId = null, settings } = {}) {
    if (!settings || disposed) return;
    editingId = sampleId;
    $('Font').value = ultraTextFontId(settings.font);
    for (const [key, value] of Object.entries({ Message: settings.message, Mode: settings.mode, Span: settings.span, Beats: settings.beats, Position: settings.lowestNote, Scale: settings.scale })) {
      if (value !== undefined) { $(key).value = String(value); knobs.update($(key)); }
    }
    $('Fit').checked = settings.fit !== false;
    for (const radio of host.querySelectorAll('[name="blechTextAlign"]')) radio.checked = radio.value === (settings.align || 'center');
    // Width can expand the position range; restore the saved position after it.
    $('Position').max = String(128 - Number($('Span').value)); $('Position').value = String(settings.lowestNote ?? 40);
    flush(); $('Message').focus({ preventScroll: true });
  }, dispose() {
    if (disposed) return;
    disposed = true; events.abort(); resize.disconnect(); knobs.destroy();
    if (queued !== null) cancelAnimationFrame(queued); host.replaceChildren();
  } };
}

const clamp = (value, low, high) => Math.max(low, Math.min(high, value));

// Browser text is for editing; all four MIDI faces are authored note cells,
// never downsampled browser outlines that lose stems at keyboard resolution.
export const FREE_TEXT_FONTS = Object.freeze([
  { id: 'digital', label: 'Digital', family: '"DSEG14 Classic Mini", ui-monospace, monospace' },
  { id: 'pixel', label: 'Arcade', family: 'ui-monospace, "DejaVu Sans Mono", monospace' },
  { id: 'square', label: 'Square', family: '"Courier New", "Liberation Mono", monospace' },
  { id: 'chunky', label: 'Chunky', family: '"Arial Black", "DejaVu Sans Mono", monospace' },
]);
const FREE_TEXT_SIZES = [16, 20, 24, 32];

function noteFontGlyphs(message, { font, bold, italic }) {
  const text = [...String(message ?? '').normalize('NFC').replace(/[\u0000-\u001f\u007f]/g, ' ')]
    .slice(0, MAX_TEXT_MIDI_GLYPHS).join('').trim();
  const glyphs = [...text].map(character => {
    if (character === ' ') return { character, width: 4, rows: null };
    const stencil = ultraNoteGlyph(character, font);
    if (!stencil) return { character, width: 4, rows: null };
    const shift = italic ? 2 : 0, thick = bold ? 1 : 0;
    const width = stencil[0].length + shift + thick;
    const rows = stencil.map((line, row) => {
      const offset = italic ? Math.floor((6 - row) / 3) : 0;
      const pixels = Array(width).fill(0);
      for (let column = 0; column < line.length; column++) if (line[column] === '1') {
        pixels[column + offset] = 1;
        if (bold) pixels[column + offset + 1] = 1;
      }
      return pixels;
    });
    return { character, width, rows };
  });
  return { text, glyphs };
}

/** Rotate the whole word, not each glyph. A cell grows equally in pitch and
 * time: turning it does not turn a wide note pixel into a thin one. */
export function layoutFreeTextGlyphs(glyphs, { pitch = 60, size = 1, orientation = 'horizontal' } = {}) {
  const requested = Math.round(clamp(Number(size) || 1, 1, 4));
  const vertical = orientation === 'vertical';
  for (let scale = requested; scale >= 1; scale--) {
    const maxWidth = Math.max(1, ...glyphs.map(glyph => glyph.width * scale));
    const lowestNote = Math.round(clamp(Number(pitch) || 0, 0, 128 - maxWidth));
    const available = vertical ? 256 : 128 - lowestNote;
    const lines = [];
    let line = { glyphs: [], text: '', width: 0 };
    for (const glyph of glyphs.slice(0, MAX_TEXT_MIDI_GLYPHS)) {
      let gap = line.glyphs.length ? scale : 0;
      if (line.glyphs.length && line.width + gap + glyph.width * scale > available) {
        lines.push(line); line = { glyphs: [], text: '', width: 0 }; gap = 0;
      }
      line.glyphs.push({ ...glyph, x: line.width + gap });
      line.text += glyph.character;
      line.width += gap + glyph.width * scale;
    }
    if (line.glyphs.length) lines.push(line);
    if (vertical && lines.length * 8 * scale > 128) continue; // Prefer an intact smaller word to cropped pitches.
    const columns = Math.max(1, ...lines.map(item => item.width));
    const pixels = Array.from({ length: lines.length * 8 }, () => Array(columns).fill(0));
    lines.forEach((item, index) => {
      for (const glyph of item.glyphs) if (glyph.rows)
        for (let row = 0; row < 7; row++) for (let column = 0; column < glyph.width; column++)
          if (glyph.rows[row][column]) for (let extra = 0; extra < scale; extra++)
            pixels[pixels.length - (index + 1) * 8 + 1 + row][glyph.x + column * scale + extra] = 1;
    });
    if (!vertical) return { pixels, lines: lines.map(item => item.text), lowestNote, columns, scale };
    // Counterclockwise on the falling stage: left-to-right writing becomes
    // bottom-to-top playback. Each time-row becomes scale pitch columns;
    // its former scale pitch columns already become scale time rows.
    const turned = Array.from({ length: columns }, (_, row) =>
      pixels.flatMap(line => Array(scale).fill(line[columns - 1 - row])));
    return { pixels: turned, lines: lines.map(item => item.text),
      lowestNote: Math.round(clamp(Number(pitch) || 0, 0, 128 - pixels.length * scale)),
      columns: pixels.length * scale, scale };
  }
  throw new Error('Text cannot fit the MIDI grid.');
}

function prepareNoteFontFreeTextMidi(message, options) {
  const { font, size, bold = false, italic = false, orientation = 'horizontal', pitch = 60, delayBeats = 2 } = options;
  const { text, glyphs } = noteFontGlyphs(message, { font, bold, italic });
  if (!text || !glyphs.some(glyph => glyph.rows?.some(row => row.includes(1))))
    throw new Error('Type visible letters to drop.');
  const layout = layoutFreeTextGlyphs(glyphs, { pitch, size, orientation });
  const vertical = orientation === 'vertical';
  const beats = vertical ? layout.pixels.length / 4 : Math.min(64, 2 * layout.scale * layout.lines.length);
  const gcd = (a, b) => b ? gcd(b, a % b) : a;
  const denominator = layout.pixels.length * 4;
  const ticksPerBeat = vertical ? 480 : 480 / gcd(480, denominator) * denominator;
  const score = generateGridMidi(layout.pixels, { title: `Text: ${text}`, lowestNote: layout.lowestNote,
    secondsPerRow: beats / (layout.pixels.length * 2), ticksPerBeat });
  const delay = Math.round(clamp(Number(delayBeats) || 0, 0, 64) * 4) / 4;
  const textSettings = { message: text, font, scale: layout.scale, bold: Boolean(bold), italic: Boolean(italic),
    orientation: orientation === 'vertical' ? 'vertical' : 'horizontal', freeStyle: true,
    span: layout.columns, lowestNote: layout.lowestNote, beats, delayBeats: delay };
  return { ...score, text, unsupported: [], lines: layout.lines.map(line => ({ text: line })),
    layout: { ...textSettings }, delayBeats: delay, textSettings };
}

/** A typed phrase starts at the chosen pitch and time. Keep its glyphs at
 * their natural size; wrap at the keyboard's right edge instead of squeezing
 * the letters or putting notes outside MIDI's 0–127 range. */
export function prepareFreeTextMidi(message, { pitch = 60, delayBeats = 2, font = 'block', size = 1,
  bold = false, italic = false, orientation = 'horizontal', rasterCanvas = null } = {}) {
  if (FREE_TEXT_FONTS.some(option => option.id === font))
    return prepareNoteFontFreeTextMidi(message, { pitch, delayBeats, font, size, bold, italic, orientation });
  const scale = Math.round(clamp(Number(size) || 1, 1, 4));
  const glyphWidth = Math.max(12, textMidiGlyphColumns(font) * scale);
  const lowestNote = Math.round(clamp(Number(pitch) || 0, 0, 128 - glyphWidth));
  const options = { font, span: 128 - lowestNote, lowestNote, mode: 'word', fit: false, scale, align: 'left' };
  let score = generateLaidOutTextMidi(message, { ...options, beats: 2 * scale });
  const beats = Math.min(64, 2 * scale * score.lines.length);
  if (beats !== score.layout.beats) score = generateLaidOutTextMidi(message, { ...options, beats });
  return { ...score, delayBeats: Math.round(clamp(Number(delayBeats) || 0, 0, 64) * 4) / 4,
    textSettings: { message, ...options, font: score.layout.font ?? 'block', span: score.layout.span,
      lowestNote: score.layout.lowestNote, scale: score.layout.scale, beats: score.layout.beats } };
}

/** The Free Text canvas has no workbox or clock. Its notes stay a silent
 * preview until Return sends one immutable score to the layer engine. */
export function mountBlechFreeText(viewport, { getTempo = () => 120, getView = () => ({}), onDrop, onApply } = {}) {
  const events = new AbortController(), on = (node, type, fn) => node.addEventListener(type, fn, { signal: events.signal });
  const overlay = document.createElement('div');
  overlay.className = 'blech-free-text-overlay';
  overlay.hidden = true; overlay.tabIndex = -1; overlay.dataset.spaceKeyOwner = '';
  overlay.setAttribute('role', 'group');
  overlay.setAttribute('aria-label', 'Free Text canvas. Click to place a text cursor, or use arrows to choose pitch and time and Enter to place it. Type, then press Return or click another spot to drop once. Escape cancels.');
  overlay.innerHTML = `<canvas aria-hidden="true"></canvas><span class="blech-free-text-target" aria-hidden="true"></span>
    <input id="blechFreeTextInput" type="text" maxlength="${MAX_TEXT_MIDI_GLYPHS}" autocomplete="off" autocapitalize="off"
      spellcheck="false" enterkeyhint="done" aria-label="Text as MIDI; Return or clicking a new spot commits, Escape cancels" hidden>
    <div id="blechFreeTextToolbar" class="blech-free-text-toolbar" role="group" aria-label="Text font, direction and sound" hidden>
      <label><span class="sr-only">Font</span><select id="blechFreeTextFont" aria-label="Font">${FREE_TEXT_FONTS.map(face => `<option value="${face.id}">${face.label}</option>`).join('')}</select></label>
      <label><span class="sr-only">Font size</span><select id="blechFreeTextSize" aria-label="Font size">${FREE_TEXT_SIZES.map((px, index) => `<option value="${index + 1}">${px} px</option>`).join('')}</select></label>
      <button type="button" data-free-text-bold aria-label="Bold" aria-keyshortcuts="Control+B Meta+B" aria-pressed="false" title="Bold · Ctrl/⌘ B"><b>B</b></button>
      <button type="button" data-free-text-italic aria-label="Italic" aria-keyshortcuts="Control+I Meta+I" aria-pressed="false" title="Italic · Ctrl/⌘ I"><i>I</i></button>
      <span role="group" aria-label="Text direction"><button type="button" data-free-text-direction="horizontal" aria-label="Horizontal text" aria-pressed="true" title="Across pitches">↔</button><button type="button" data-free-text-direction="vertical" aria-label="Vertical text" aria-pressed="false" title="Rotate word 90° · first letter plays first">↕</button></span>
      <label><span class="sr-only">MIDI channel</span><select id="blechFreeTextChannel" aria-label="Free Text MIDI channel" title="Channel for this word when it drops">${Array.from({ length: 16 }, (_, i) => `<option value="${i}">ch${i + 1}${i === 9 ? ' drums' : ''}</option>`).join('')}</select></label>
      <label class="blech-free-text-volume" title="Free Text volume · 0–127 · drag up/down or use arrow keys">
        <span class="sr-only">Free Text volume</span><input id="blechFreeTextVolume" type="range" min="0" max="127" step="1" value="95" aria-label="Free Text volume, 0 to 127">
        <output id="blechFreeTextVolumeOut" for="blechFreeTextVolume" aria-hidden="true">95</output>
      </label>
    </div>
    <output id="blechFreeTextStatus" class="blech-free-text-status" role="status"></output>`;
  viewport.append(overlay);
  const canvas = overlay.querySelector('canvas'), context = canvas.getContext('2d');
  const input = overlay.querySelector('#blechFreeTextInput'), target = overlay.querySelector('.blech-free-text-target');
  const status = overlay.querySelector('#blechFreeTextStatus');
  const toolbar = overlay.querySelector('#blechFreeTextToolbar');
  const fontSelect = toolbar.querySelector('#blechFreeTextFont'), sizeSelect = toolbar.querySelector('#blechFreeTextSize');
  const boldButton = toolbar.querySelector('[data-free-text-bold]'), italicButton = toolbar.querySelector('[data-free-text-italic]');
  const channelSelect = toolbar.querySelector('#blechFreeTextChannel');
  const volumeInput = toolbar.querySelector('#blechFreeTextVolume'), volumeOut = toolbar.querySelector('#blechFreeTextVolumeOut');
  const knobs = mountMixerKnobs(toolbar);
  const rasterCanvas = document.createElement('canvas');
  let active = false, disposed = false, placement = null, prepared = null, scheduled = null;
  let font = 'digital', size = 1, bold = false, italic = false, orientation = 'horizontal', editingId = null;
  let channel = 0, volume = 95;
  let cursor = { pitch: 60, delayBeats: 2 };
  const geometry = () => {
    const rect = viewport.getBoundingClientRect();
    return spigotGeometry(rect.width, rect.height, getTempo(), getView());
  };
  function render() {
    if (disposed || !active) return;
    const g = geometry();
    overlay.style.height = `${Math.max(0, g.present - 2)}px`;
    const ratio = Math.min(devicePixelRatio || 1, 2, Math.sqrt(650_000 / Math.max(1, g.width * g.present)));
    const width = Math.max(1, Math.round(g.width * ratio)), height = Math.max(1, Math.round(g.present * ratio));
    if (canvas.width !== width || canvas.height !== height) { canvas.width = width; canvas.height = height; }
    else { context.setTransform(1, 0, 0, 1, 0, 0); context.clearRect(0, 0, width, height); }
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
    prepared = null;
    if (placement && input.value.trim()) {
      try {
        prepared = prepareFreeTextMidi(input.value, { ...placement, font, size, bold, italic, orientation, rasterCanvas });
        status.value = `${editingId !== null ? 'Return ↵ or tap elsewhere updates' : 'Return ↵ or tap elsewhere drops'} · Esc cancels${prepared.layout.scale < size ? ' · smaller to fit MIDI' : ''}`;
      } catch (error) { status.value = error.message; }
    } else status.value = placement ? 'Type a word · Return ↵ or tap elsewhere drops' : 'Tap to place text · arrows + Enter also work';
    if (prepared) {
      context.fillStyle = '#c7ff2a'; context.globalAlpha = .65;
      for (const note of prepared.notes) {
        const key = g.layout[note.note];
        if (!key) continue;
        // The generator's MIDI file is 120 BPM: seconds × 2 = master beats.
        const top = g.present - (placement.delayBeats + (note.start + note.duration) * 2) * g.pixelsPerBeat;
        const bottom = g.present - (placement.delayBeats + note.start * 2) * g.pixelsPerBeat;
        if (bottom <= 0 || top >= g.present) continue;
        context.fillRect(key.x * g.width, Math.max(0, top), Math.max(1, key.width * g.width),
          Math.max(1, Math.min(g.present, bottom) - Math.max(0, top)));
      }
      context.globalAlpha = 1;
    }
    overlay.dataset.noteCount = String(prepared?.notes.length ?? 0);
    const anchor = placement ?? cursor;
    const key = g.layout[prepared?.layout.lowestNote ?? anchor.pitch];
    const x = clamp(key.x * g.width, 2,
      Math.max(2, g.width - (orientation === 'vertical' ? FREE_TEXT_SIZES[size - 1] * 1.5 : 28) - 4));
    const y = clamp(g.present - anchor.delayBeats * g.pixelsPerBeat, 4, Math.max(4, g.present - 3));
    target.style.left = `${x}px`; target.style.top = `${y}px`;
    target.hidden = Boolean(placement);
    input.hidden = !placement;
    toolbar.hidden = !placement;
    if (placement) {
      const fontSize = FREE_TEXT_SIZES[size - 1], vertical = orientation === 'vertical';
      const face = FREE_TEXT_FONTS.find(option => option.id === font) ?? FREE_TEXT_FONTS[0];
      input.style.fontFamily = face.family;
      input.style.fontWeight = font === 'digital' || bold ? '700' : '400';
      input.style.fontStyle = italic ? 'italic' : 'normal';
      input.style.textTransform = 'uppercase';
      input.style.webkitTextStroke = bold ? '.6px currentColor' : '';
      input.dataset.font = font;
      input.dataset.orientation = orientation;
      input.style.left = `${x}px`;
      input.style.fontSize = `${fontSize}px`;
      const editor = rasterCanvas.getContext('2d');
      editor.font = `${italic ? 'italic ' : ''}${font === 'digital' || bold ? '700' : '400'} ${fontSize}px ${face.family}`;
      const extent = editor.measureText(input.value || 'W').width;
      const inputHeight = vertical ? Math.min(g.present - 4, Math.max(30, extent + fontSize)) : fontSize * 1.35;
      const inputTop = vertical ? clamp(y - inputHeight + 4, 0, Math.max(0, g.present - inputHeight))
        : clamp(y - fontSize - 3, 0, Math.max(0, g.present - fontSize - 6));
      input.style.top = `${inputTop}px`;
      const inputWidth = vertical ? fontSize * 1.5 : Math.max(24, Math.min(g.width - x - 2, extent + 18));
      input.style.width = `${inputWidth}px`;
      input.style.height = `${inputHeight}px`;
      const toolWidth = toolbar.offsetWidth, toolHeight = toolbar.offsetHeight;
      const above = inputTop - toolHeight - 5, below = inputTop + inputHeight + 5;
      const right = x + inputWidth + 4, left = x - toolWidth - 4;
      const side = right + toolWidth <= g.width - 4 ? right : left >= 4 ? left : null;
      const beside = clamp(inputTop + (inputHeight - toolHeight) / 2, 4, Math.max(4, g.present - toolHeight - 4));
      let toolX = x, toolY;
      if (vertical && side !== null) { toolX = side; toolY = beside; }
      else if (above >= 4) toolY = above;
      else if (below + toolHeight <= g.present - 4) toolY = below;
      else if (side !== null) { toolX = side; toolY = beside; }
      else toolY = clamp(above, 4, Math.max(4, g.present - toolHeight - 4));
      toolbar.style.left = `${clamp(toolX, 4, Math.max(4, g.width - toolWidth - 4))}px`;
      toolbar.style.top = `${toolY}px`;
    }
  }
  function schedule() {
    if (!active || scheduled !== null) return;
    scheduled = requestAnimationFrame(() => { scheduled = null; render(); });
  }
  function clear() {
    placement = null; prepared = null; editingId = null; input.value = ''; input.hidden = true; toolbar.hidden = true;
    if (active) render();
  }
  function position(point) {
    placement = cursor = point;
    render();
    input.focus({ preventScroll: true });
    input.setSelectionRange(input.value.length, input.value.length);
  }
  function drop() {
    if (scheduled !== null) { cancelAnimationFrame(scheduled); scheduled = null; }
    render();
    if (!prepared) return false;
    try {
      const gain = volume / 127;
      const score = { ...prepared, analysis: parseMidi(prepared.buffer),
        textSettings: { ...prepared.textSettings, channel, gain } };
      const name = `Text · ${score.text.replace(/\n/g, ' / ')}`, updating = editingId !== null;
      const sent = updating ? onApply?.(editingId, score, { name, when: 'restart' })
        : onDrop?.(score, { name, source: 'text', delayBeats: score.delayBeats,
          channel, gain, loop: false, transpose: 0, widthNotes: null, heightBeats: null, rotationDegrees: 0 });
      if (!sent) throw new Error('Could not drop this text. Try again.');
      clear(); overlay.focus({ preventScroll: true });
      status.value = updating ? 'Text updated. Tap to place another.' : 'Text dropped once. Tap to place another.';
      return true;
    } catch (error) { status.value = error.message || 'Could not drop this text.'; return false; }
  }
  on(overlay, 'click', event => {
    if (event.target === input || toolbar.contains(event.target) || !active) return;
    const rect = viewport.getBoundingClientRect(), g = geometry();
    // A new placement commits the previous word, but never drops blank or
    // unplayable text. Keep a failed draft in place so it can be corrected.
    if (placement && input.value.trim() && !drop()) return;
    if (!input.value.trim()) input.value = '';
    position(spigotPoint(event.clientX - rect.left, event.clientY - rect.top, g));
  });
  function reflectTools() {
    fontSelect.value = font; sizeSelect.value = String(size); channelSelect.value = String(channel);
    volumeInput.value = String(volume); volumeOut.value = String(volume); knobs.update(volumeInput);
    boldButton.setAttribute('aria-pressed', String(bold));
    italicButton.setAttribute('aria-pressed', String(italic));
    for (const button of toolbar.querySelectorAll('[data-free-text-direction]'))
      button.setAttribute('aria-pressed', String(button.dataset.freeTextDirection === orientation));
    schedule();
  }
  on(fontSelect, 'change', () => { font = fontSelect.value; reflectTools(); input.focus({ preventScroll: true }); });
  on(sizeSelect, 'change', () => { size = Number(sizeSelect.value); reflectTools(); input.focus({ preventScroll: true }); });
  on(channelSelect, 'change', () => { channel = Number(channelSelect.value); input.focus({ preventScroll: true }); });
  on(volumeInput, 'input', () => { volume = Number(volumeInput.value); volumeOut.value = String(volume); });
  on(boldButton, 'click', () => { bold = !bold; reflectTools(); input.focus({ preventScroll: true }); });
  on(italicButton, 'click', () => { italic = !italic; reflectTools(); input.focus({ preventScroll: true }); });
  for (const button of toolbar.querySelectorAll('[data-free-text-direction]')) on(button, 'click', () => {
    orientation = button.dataset.freeTextDirection; reflectTools(); input.focus({ preventScroll: true });
  });
  on(overlay, 'keydown', event => {
    if ((event.ctrlKey || event.metaKey) && ['b', 'i'].includes(event.key.toLowerCase())) {
      event.preventDefault(); event.stopPropagation();
      if (event.key.toLowerCase() === 'b') bold = !bold; else italic = !italic;
      reflectTools(); input.focus({ preventScroll: true }); return;
    }
    if (toolbar.contains(event.target) && event.key === 'Escape') {
      event.preventDefault(); event.stopPropagation(); clear(); overlay.focus({ preventScroll: true }); return;
    }
    if (event.target !== overlay) return;
    const pitchDelta = { ArrowLeft: -1, ArrowRight: 1, Home: -128, End: 128 }[event.key];
    const timeDelta = { ArrowUp: .25, ArrowDown: -.25 }[event.key];
    if (pitchDelta !== undefined || timeDelta !== undefined) {
      event.preventDefault();
      cursor = { pitch: clamp(cursor.pitch + (pitchDelta ?? 0), 0, 127),
        delayBeats: clamp(cursor.delayBeats + (timeDelta ?? 0), 0, 64) };
      render();
    } else if (event.key === 'Enter') { event.preventDefault(); if (!event.repeat) position(cursor); }
    else if (event.key === 'Escape') { event.preventDefault(); clear(); }
  });
  on(input, 'input', schedule);
  on(input, 'keydown', event => {
    if (event.key === 'Enter' && !event.isComposing && event.keyCode !== 229) {
      event.preventDefault(); event.stopPropagation(); drop();
    } else if (event.key === 'Escape') {
      event.preventDefault(); event.stopPropagation(); clear(); overlay.focus({ preventScroll: true });
    }
  });
  const resize = new ResizeObserver(schedule); resize.observe(viewport);
  reflectTools();
  return {
    activate({ focus = false } = {}) {
      if (disposed) return;
      active = true; overlay.hidden = false; overlay.tabIndex = 0; render();
      if (focus) overlay.focus({ preventScroll: true });
    },
    deactivate() {
      if (!active) return;
      active = false; overlay.hidden = true; overlay.tabIndex = -1;
      if (scheduled !== null) { cancelAnimationFrame(scheduled); scheduled = null; }
      placement = null; prepared = null; editingId = null; input.value = '';
      input.hidden = true; toolbar.hidden = true; status.value = '';
    },
    configure(options = {}) {
      if (FREE_TEXT_FONTS.some(option => option.id === options.font)) font = options.font;
      if (options.size !== undefined) size = Math.round(clamp(Number(options.size) || size, 1, 4));
      if (options.bold !== undefined) bold = Boolean(options.bold);
      if (options.italic !== undefined) italic = Boolean(options.italic);
      if (['horizontal', 'vertical'].includes(options.orientation)) orientation = options.orientation;
      if (options.channel !== undefined) channel = Math.round(clamp(Number(options.channel) || 0, 0, 15));
      if (options.gain !== undefined) volume = Math.round(clamp(Number(options.gain ?? .75) * 127, 0, 127));
      reflectTools();
    },
    edit({ sampleId = null, settings } = {}) {
      if (!settings || disposed) return;
      font = FREE_TEXT_FONTS.some(option => option.id === settings.font) ? settings.font : 'digital';
      size = Math.round(clamp(Number(settings.scale) || 1, 1, 4));
      bold = Boolean(settings.bold); italic = Boolean(settings.italic);
      orientation = settings.orientation === 'vertical' ? 'vertical' : 'horizontal';
      channel = Math.round(clamp(Number(settings.channel) || 0, 0, 15));
      volume = Math.round(clamp(Number(settings.gain ?? .75) * 127, 0, 127));
      editingId = sampleId;
      input.value = settings.message ?? '';
      placement = cursor = { pitch: settings.lowestNote ?? 60, delayBeats: settings.delayBeats ?? 2 };
      reflectTools(); render();
      input.focus({ preventScroll: true });
      input.setSelectionRange(input.value.length, input.value.length);
    },
    focusDraft() {
      if (!active || !placement || disposed) return false;
      input.focus({ preventScroll: true });
      return true;
    },
    refresh: schedule,
    get active() { return active; },
    dispose() {
      disposed = true; events.abort(); resize.disconnect(); knobs.destroy();
      if (scheduled !== null) cancelAnimationFrame(scheduled);
      overlay.remove();
    },
  };
}

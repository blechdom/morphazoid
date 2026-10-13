import { generateLaidOutTextMidi } from '../midiphoria/midiphoria-text-midi.js';
import { parseMidi } from '../midi-mixer/midi-mixer-model.js';
import { mountMixerKnobs } from '../midi-mixer/midi-mixer-knobs.js';
import { drawGeneratorPreview, generatorRange } from './blech-midi-generator-preview.js';

/** Draft geometry never mutates a performing layer until Apply or Drop. */
export function mountBlechText(host, { onDrop, onApply, getLayer = () => null, getTempo = () => 120, getProgram = () => '0' } = {}) {
  const events = new AbortController(), on = (node, type, fn) => node.addEventListener(type, fn, { signal: events.signal });
  host.innerHTML = `<form class="blech-generator blech-text">
    <div class="blech-text-editing" id="blechTextEditing" hidden><output id="blechTextEditingName"></output><button id="blechTextDone" type="button">Done editing</button></div>
    <label class="blech-text-message" for="blechTextMessage">Write text
      <textarea id="blechTextMessage" rows="3" maxlength="128" placeholder="Write a word, message or symbol…&#10;HELLO ❤" autocomplete="off" spellcheck="false" aria-describedby="blechTextHint">BLECH</textarea>
    </label>
    <div class="blech-generator-toolbar"><button id="blechTextClear" type="button">Clear text</button><span id="blechTextHint" class="blech-generator-hint">Enter starts a new line. Up to 32 characters, including ❤ ⭐ 🙂.</span></div>
    <div class="blech-generator-toolbar"><label for="blechTextMode">Arrange
      <select id="blechTextMode"><option value="word">Rows of text</option><option value="letter">Letters in sequence</option></select>
    </label><label class="blech-generator-check"><input id="blechTextFit" type="checkbox" checked>Fit to line</label>
    <fieldset class="blech-text-align"><legend>Align</legend><label><input type="radio" name="blechTextAlign" value="left">Left</label><label><input type="radio" name="blechTextAlign" value="center" checked>Center</label><label><input type="radio" name="blechTextAlign" value="right">Right</label></fieldset></div>
    <div class="blech-text-layout"><span id="blechTextLayoutHint" class="blech-generator-hint"></span><ol id="blechTextLines" aria-label="Line order, first played first"></ol></div>
    <figure class="blech-text-preview"><canvas id="blechTextPreview" width="800" height="256" aria-label="Prepared text notes: pitch left to right, first line at the bottom">A preview of the message as MIDI notes.</canvas>
      <figcaption><span>Low notes ← Keyboard → High notes</span><span>First line plays from the bottom</span></figcaption>
    </figure>
    <output id="blechTextStatistics"></output>
    <div class="blech-generator-toolbar blech-text-actions"><button id="blechTextApply" type="button" hidden>Apply next loop</button><button id="blechTextDrop" type="submit">Drop text</button>
      <label class="blech-generator-check"><input id="blechTextLoop" type="checkbox">Loop new text</label>
    </div>
    <output id="blechTextStatus" role="status"></output>
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
  const render = () => { if (!disposed) drawGeneratorPreview($('Preview'), score?.analysis, { grid: false }); };
  const format = value => Number(value.toFixed(2));
  const label = prepared => `Text · ${prepared.text.replace(/\n/g, ' / ')}`;
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
  function update() {
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
        beats: Number($('Beats').value), fit: $('Fit').checked, scale: Number($('Scale').value),
        align: host.querySelector('[name="blechTextAlign"]:checked').value };
      score = generateLaidOutTextMidi(settings.message, settings);
      score.analysis = parseMidi(score.buffer);
      score.textSettings = { ...settings, scale: score.layout.scale };
      $('Scale').value = String(score.layout.scale); knobs?.update($('Scale'));
      $('ScaleOut').value = `${score.layout.scale * 5} keys / letter`;
      $('LayoutHint').textContent = `${score.lines.length} prepared line${score.lines.length === 1 ? '' : 's'} · ${score.layout.capacity} characters fit · first played first`;
      for (const line of score.lines) {
        const item = document.createElement('li'), text = document.createElement('span'), reason = document.createElement('small');
        text.textContent = line.text || '(blank line)'; reason.textContent = ({ explicit: 'Enter', wrap: 'wrap', 'hard-wrap': 'word split', letter: 'next letter', end: '' })[line.breakReason] ?? '';
        item.append(text, reason); $('Lines').append(item);
      }
      $('Statistics').value = `${score.analysis.noteCount.toLocaleString()} notes · ${score.lines.length} line${score.lines.length === 1 ? '' : 's'}`;
      $('Status').value = [score.truncated ? 'Showing the first 32 characters.' : '', score.unsupported.length ? `Skipped unsupported symbols: ${score.unsupported.join(' ')}` : ''].filter(Boolean).join(' ');
    } catch (error) {
      score = null; $('Statistics').value = ''; $('ScaleOut').value = `${Number($('Scale').value) * 5} keys / letter`;
      $('Status').value = $('Message').value.trim() ? error.message : 'Type a message to prepare its notes.';
    }
    $('Drop').disabled = !score; refresh(); render();
  }
  function queue() { if (queued === null) queued = requestAnimationFrame(() => { queued = null; update(); }); }
  function flush() { if (queued !== null) { cancelAnimationFrame(queued); queued = null; } update(); }
  for (const key of ['Message', 'Span', 'Beats', 'Position', 'Scale']) on($(key), 'input', queue);
  for (const key of ['Mode', 'Fit']) on($(key), 'change', queue);
  for (const radio of host.querySelectorAll('[name="blechTextAlign"]')) on(radio, 'change', queue);
  on($('Clear'), 'click', () => { $('Message').value = ''; flush(); $('Message').focus(); });
  on($('Done'), 'click', () => { editingId = null; refresh(); $('Status').value = ''; });
  on(form, 'submit', async event => {
    event.preventDefault(); flush(); if (!score) return;
    const prepared = score;
    try {
      await onDrop?.(prepared, { name: label(prepared), program: getProgram(), loop: $('Loop').checked });
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
  return { refreshTempo, refresh, edit({ sampleId = null, settings } = {}) {
    if (!settings || disposed) return;
    editingId = sampleId;
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

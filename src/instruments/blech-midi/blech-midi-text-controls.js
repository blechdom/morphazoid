import { mixerMessageScore } from '../midi-mixer/midi-mixer-performance-score.js';
import { parseMidi } from '../midi-mixer/midi-mixer-model.js';
import { mountMixerKnobs } from '../midi-mixer/midi-mixer-knobs.js';
import { drawGeneratorPreview, generatorRange } from './blech-midi-generator-preview.js';

/** Text preparation owns its geometry and loop policy; each Drop is a snapshot. */
export function mountBlechText(host, { onDrop, getTempo = () => 120, getProgram = () => '0' } = {}) {
  const events = new AbortController(), on = (node, type, fn) => node.addEventListener(type, fn, { signal: events.signal });
  host.innerHTML = `<form class="blech-generator blech-text">
    <label class="blech-text-message" for="blechTextMessage">Message
      <input id="blechTextMessage" type="text" value="BLECH" maxlength="64" placeholder="HELLO ❤" autocomplete="off" spellcheck="false" aria-describedby="blechTextHint">
    </label>
    <div class="blech-generator-toolbar"><label for="blechTextMode">Arrange
      <select id="blechTextMode"><option value="word">Rows of text</option><option value="letter">Letters in sequence</option></select>
    </label><span id="blechTextLayoutHint" class="blech-generator-hint"></span></div>
    <figure class="blech-text-preview"><canvas id="blechTextPreview" width="800" height="256" aria-label="Prepared text notes: pitch left to right, first notes at the bottom">A preview of the message as MIDI notes.</canvas>
      <figcaption><span>Low notes ← Keyboard → High notes</span><span>Bottom plays first</span></figcaption>
    </figure>
    <output id="blechTextStatistics"></output>
    <div class="blech-generator-toolbar blech-text-actions"><button id="blechTextDrop" type="submit">Drop text</button>
      <label class="blech-generator-check"><input id="blechTextLoop" type="checkbox">Loop new text</label>
    </div>
    <output id="blechTextStatus" role="status"></output>
    <div class="blech-generator-controls blech-text-size">
      ${generatorRange('blechText', 'Beats', 'Total duration', .25, 64, .25, 8)}
      ${generatorRange('blechText', 'Span', 'Keyboard width', 12, 128, 1, 48)}
    </div>
    <label class="blech-text-position" for="blechTextPosition"><span>Keyboard position <output id="blechTextPositionOut"></output></span>
      <input id="blechTextPosition" type="range" min="0" max="80" step="1" value="40" data-keep-slider aria-describedby="blechTextPositionOut">
    </label>
    <p id="blechTextHint" class="blech-generator-hint">Up to 32 characters, including ❤ ⭐ 🙂. Each Drop adds a layer; pause or stop it in Layers above.</p>
  </form>`;
  const $ = key => host.querySelector(`#blechText${key}`), form = host.querySelector('form');
  let disposed = false, queued = null, score = null;
  const render = () => { if (!disposed) drawGeneratorPreview($('Preview'), score?.analysis); };
  const format = value => Number(value.toFixed(2));
  function refreshTempo() {
    const beats = Number($('Beats').value), seconds = beats * 60 / getTempo();
    $('BeatsOut').value = `${beats} beats · ${format(seconds)} s`;
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
    $('LayoutHint').textContent = $('Mode').value === 'letter' ? 'One character after another.' : 'Up to 8 characters together per row.';
    score = null; $('Status').value = '';
    try {
      score = mixerMessageScore($('Message').value, { orientation: 'falling', mode: $('Mode').value,
        span, beats: Number($('Beats').value), lowestNote: low });
      score.analysis = parseMidi(score.buffer);
      const unit = $('Mode').value === 'letter' ? 'character' : 'row';
      $('Statistics').value = `“${score.text}” · ${score.analysis.noteCount.toLocaleString()} notes · ${score.phrases.length} ${unit}${score.phrases.length === 1 ? '' : 's'}`;
      if (score.unsupported.length) $('Status').value = `Skipped unsupported symbols: ${score.unsupported.join(' ')}`;
    } catch (error) {
      score = null;
      $('Statistics').value = '';
      $('Status').value = $('Message').value.trim() ? error.message : 'Type a message to prepare its notes.';
    }
    $('Drop').disabled = !score;
    render();
  }
  function queue() {
    if (queued === null) queued = requestAnimationFrame(() => { queued = null; update(); });
  }
  for (const key of ['Message', 'Span', 'Beats', 'Position']) on($(key), 'input', queue);
  on($('Mode'), 'change', queue);
  on(form, 'submit', async event => {
    event.preventDefault();
    if (queued !== null) { cancelAnimationFrame(queued); queued = null; }
    update(); if (!score) return;
    const prepared = score;
    try {
      await onDrop?.(prepared, { name: `Text · ${prepared.text}`, program: getProgram(), loop: $('Loop').checked });
      if (!disposed) $('Status').value = `“${prepared.text}” added to Layers.${prepared.unsupported.length ? ` Skipped: ${prepared.unsupported.join(' ')}.` : ''}`;
    } catch (error) { if (!disposed) $('Status').value = error.message; }
  });
  const resize = new ResizeObserver(render); resize.observe($('Preview'));
  update(); const knobs = mountMixerKnobs(host);
  return { refreshTempo, dispose() {
    if (disposed) return;
    disposed = true; events.abort(); resize.disconnect(); knobs.destroy();
    if (queued !== null) cancelAnimationFrame(queued);
    host.replaceChildren();
  } };
}

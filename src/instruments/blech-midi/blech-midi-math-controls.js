import { MATH_PRESETS, mathArtwork, encodeMath } from './blech-midi-math.js';
import { drawGeneratorPreview, generatorRange } from './blech-midi-generator-preview.js';
import { mountMixerKnobs } from '../midi-mixer/midi-mixer-knobs.js';

export function mountBlechMath(host, { getTempo = () => 120, onDrop, onPreview } = {}) {
  const events = new AbortController(), on = (node, type, fn) => node.addEventListener(type, fn, { signal: events.signal });
  const range = (...args) => generatorRange('blechMath', ...args);
  const bound = (key, name, value) => `<label>${name}<input id="blechMath${key}" type="number" min="-1000000" max="1000000" step="any" value="${value}"></label>`;
  host.innerHTML = `<div class="blech-generator blech-math">
    <div class="blech-generator-toolbar"><label>Pattern<select id="blechMathPreset">${MATH_PRESETS.map(preset => `<option value="${preset.id}">${preset.name}</option>`).join('')}<option value="custom" hidden>Custom</option></select></label>
    <label>Graph<select id="blechMathMode"><option value="function">y = f(x)</option><option value="parametric">x(t), y(t)</option></select></label>
    <button id="blechMathDrop" class="mini-action" type="button">Drop pattern</button><label class="blech-generator-check"><input id="blechMathLoop" type="checkbox" checked>Loop</label></div>
    <div class="blech-math-equations"><label id="blechMathFunctionRow">y =<input id="blechMathEquation" type="text" value="sin(3*x)" maxlength="256" spellcheck="false" autocomplete="off" aria-label="Math expression y equals"></label>
    <label id="blechMathParamXRow" hidden>x(t) =<input id="blechMathEquationX" type="text" value="sin(3*t)" maxlength="256" spellcheck="false" autocomplete="off" aria-label="Parametric time x of t"></label>
    <label id="blechMathParamYRow" hidden>y(t) =<input id="blechMathEquationY" type="text" value="sin(4*t)" maxlength="256" spellcheck="false" autocomplete="off" aria-label="Parametric pitch y of t"></label></div>
    <div class="blech-generator-work"><canvas id="blechMathPreview" width="800" height="256" aria-label="Prepared math notes: pitch left to right, time bottom to top">Equation samples become MIDI notes.</canvas>
    <div class="blech-generator-controls">${range('Beats', 'Length · beats', .25, 128, .25, 8)}${range('Width', 'Width · notes', 1, 16, 1, 1)}${range('Samples', 'Samples', 8, 1024, 1, 256)}${range('Gate', 'Note length', .05, 4, .05, .9)}${range('Low', 'Lowest pitch', 0, 127, 1, 0)}${range('High', 'Highest pitch', 0, 127, 1, 127)}${range('Velocity', 'Velocity', 1, 127, 1, 96)}</div></div>
    <output id="blechMathStatistics"></output><output id="blechMathStatus" role="status"></output>
    <details class="blech-generator-settings"><summary>Graph bounds &amp; functions</summary><div class="blech-generator-bounds">
    ${bound('DomainMin', 'Input start', 0)}${bound('DomainMax', 'Input end', 6.28318530718)}${bound('YMin', 'Y minimum', -1)}${bound('YMax', 'Y maximum', 1)}
    <div id="blechMathXBounds" class="blech-generator-param-bounds" hidden>${bound('XMin', 'X minimum', -1)}${bound('XMax', 'X maximum', 1)}</div></div>
    <p>Graph x maps to time, y to pitch; the note preview turns this upright. Trig functions use radians. Use *, /, +, −, ^, %, pi, tau, e; sin, cos, tan, asin, acos, atan, abs, sqrt, log, exp, floor, ceil, round, sign, min, max, pow, atan2. Points outside the bounds are omitted.</p></details>
    <button id="blechMathScore" class="mini-action" type="button" ${onPreview ? '' : 'hidden'}>Preview score</button>
  </div>`;
  const $ = key => host.querySelector(`#blechMath${key}`), canvas = $('Preview');
  let disposed = false, queued = null, artwork = null, error = '', currentName = MATH_PRESETS[0].name;
  const fields = ['Equation', 'EquationX', 'EquationY', 'Mode', 'DomainMin', 'DomainMax', 'YMin', 'YMax', 'XMin', 'XMax', 'Beats', 'Width', 'Samples', 'Gate', 'Low', 'High', 'Velocity'];
  const options = () => Object.fromEntries(fields.map(key => [key[0].toLowerCase() + key.slice(1), $(key).type === 'range' || $(key).type === 'number' ? $(key).value === '' ? NaN : Number($(key).value) : $(key).value]));
  const render = () => { if (!disposed) drawGeneratorPreview(canvas, artwork); };
  function update() {
    if (disposed) return;
    const parametric = $('Mode').value === 'parametric';
    $('FunctionRow').hidden = parametric; $('ParamXRow').hidden = $('ParamYRow').hidden = $('XBounds').hidden = !parametric;
    for (const input of host.querySelectorAll('input[type="range"]')) $(`${input.id.slice(9)}Out`).value = String(Number(input.value));
    try {
      artwork = mathArtwork(options()); error = artwork.notes.length ? '' : 'No notes inside these graph bounds.';
      $('Statistics').value = `${artwork.notes.length.toLocaleString()} notes · ${artwork.durationBeats} beats${artwork.skipped ? ` · ${artwork.skipped} samples outside bounds` : ''}`;
    } catch (caught) { error = caught.message; artwork = null; $('Statistics').value = ''; }
    $('Status').value = error; $('Drop').disabled = $('Score').disabled = Boolean(error); render();
  }
  function queue() {
    $('Preset').value = 'custom'; currentName = 'Custom equation';
    if (queued === null) queued = requestAnimationFrame(() => { queued = null; update(); });
  }
  for (const key of fields) on($(key), $(key).tagName === 'SELECT' ? 'change' : 'input', queue);
  on($('Preset'), 'change', () => {
    const preset = MATH_PRESETS.find(item => item.id === $('Preset').value); if (!preset) return;
    for (const key of fields) { const value = preset[key[0].toLowerCase() + key.slice(1)]; if (value !== undefined) $(key).value = String(value); }
    currentName = preset.name; update();
  });
  const getScore = () => { update(); if (error) throw new Error(error); return encodeMath({ ...options(), name: currentName }, getTempo()); };
  on($('Drop'), 'click', async () => {
    try { const score = getScore(); await onDrop?.(score, { name: currentName, program: 'original', loop: $('Loop').checked }); if (!disposed) $('Status').value = `${score.analysis.noteCount.toLocaleString()} notes dropped to an independent pad.`; }
    catch (caught) { if (!disposed) $('Status').value = caught.message; }
  });
  on($('Score'), 'click', async () => { try { await onPreview?.(getScore()); } catch (caught) { if (!disposed) $('Status').value = caught.message; } });
  const resize = new ResizeObserver(render); resize.observe(canvas);
  update(); const knobs = mountMixerKnobs(host);
  return { getScore, dispose() { if (disposed) return; disposed = true; events.abort(); resize.disconnect(); knobs.destroy(); if (queued !== null) cancelAnimationFrame(queued); host.replaceChildren(); } };
}

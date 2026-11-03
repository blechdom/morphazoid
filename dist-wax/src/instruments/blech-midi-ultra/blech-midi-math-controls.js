import { MATH_PRESETS, mathArtwork, encodeMath } from './blech-midi-math.js';
import { generatorRange } from './blech-midi-generator-preview.js';
import { mountMixerKnobs } from '../midi-mixer/midi-mixer-knobs.js';
import { mountBlechStampPicker } from './blech-midi-stamp-picker.js';

// Almost the entire turn adjusts useful graph values; the full original
// ±1,000,000 range is still reachable at the ends of each native range.
const GRAPH_CURVE = [[-1000000, 0], [-64, .06], [-8, .22], [-2, .38], [0, .5],
  [2, .62], [8, .78], [64, .94], [1000000, 1]];
const graphBounds = ['DomainMin', 'DomainMax', 'YMin', 'YMax', 'XMin', 'XMax'];
const boundLabel = value => {
  const number = Number(value);
  return number && Math.abs(number) < .001 ? number.toExponential(2) : String(Number(number.toFixed(3)));
};

/** Catalogue geometry only: no MIDI encoding, playback, or full-density scores.
 * It uses the same pitch-horizontal/time-up projection as the prepared drop. */
export function mathPresetThumbnailArtwork(preset) {
  return mathArtwork({ ...preset, samples: 96, width: 1, low: 0, high: 127 });
}

export function mountBlechMath(host, { getTempo = () => 120, onPrepare, onWorkbox, onPresetPick } = {}) {
  const events = new AbortController(), on = (node, type, fn) => node.addEventListener(type, fn, { signal: events.signal });
  const range = (...args) => generatorRange('blechMath', ...args);
  const graphRange = (key, name, value) => range(key, name, -1000000, 1000000, 'any', value);
  host.innerHTML = `<div class="blech-generator blech-math">
    <div class="blech-generator-toolbar"><div id="blechMathPicker"></div><select id="blechMathPreset" aria-label="Math pattern" hidden>${MATH_PRESETS.map(preset => `<option value="${preset.id}">${preset.name}${preset.evolves ? ' · evolves' : ''}</option>`).join('')}<option value="custom" hidden>Custom</option></select>
    <label>Graph<select id="blechMathMode"><option value="function">y = f(x, t)</option><option value="parametric">x(t), y(t)</option></select></label>
    <button id="blechMathWorkbox" type="button" aria-label="Edit this formula in a Math workbox" title="Edit in Workbox · reshape and Loop before Drop"${onWorkbox ? '' : ' hidden'}><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true"><rect x="3" y="3" width="18" height="18" stroke-dasharray="2 2"/><path d="M12 7v10m-5-5h10"/></svg> Workbox</button></div>
    <div class="blech-math-equations"><label id="blechMathFunctionRow">y =<input id="blechMathEquation" type="text" value="sin(3*x)" maxlength="256" spellcheck="false" autocomplete="off" aria-label="Math expression y equals"></label>
    <label id="blechMathParamXRow" hidden>x(t) =<input id="blechMathEquationX" type="text" value="sin(3*t)" maxlength="256" spellcheck="false" autocomplete="off" aria-label="Parametric time x of t"></label>
    <label id="blechMathParamYRow" hidden>y(t) =<input id="blechMathEquationY" type="text" value="sin(4*t)" maxlength="256" spellcheck="false" autocomplete="off" aria-label="Parametric pitch y of t"></label></div>
    <div class="blech-generator-controls" role="group" aria-label="Math note controls">
      ${range('Samples', 'Curve points', 8, 1024, 1, 256)}
      ${range('Width', 'Stroke · notes', 1, 16, 1, 1)}
      ${range('Gate', 'Note length · ×', .05, 4, .05, .9)}
      ${range('Velocity', 'Note strength', 1, 127, 1, 96)}
    </div>
    <details class="blech-generator-settings"><summary>Graph range</summary><div class="blech-generator-bounds">
    ${graphRange('DomainMin', 'Input start', 0)}${graphRange('DomainMax', 'Input end', 6.28318530718)}${graphRange('YMin', 'Y minimum', -1)}${graphRange('YMax', 'Y maximum', 1)}
    <div id="blechMathXBounds" class="blech-generator-param-bounds" hidden>${graphRange('XMin', 'X minimum', -1)}${graphRange('XMax', 'X maximum', 1)}</div></div></details>
    <output id="blechMathStatus" role="status"></output>
  </div>`;
  const $ = key => host.querySelector(`#blechMath${key}`);
  const pickerHost = $('Picker');
  const picker = mountBlechStampPicker($('Picker'), {
    entries: [...MATH_PRESETS.map(preset => ({
      id: preset.id, title: preset.name, thumbnailStroke: 2, ...mathPresetThumbnailArtwork(preset),
      group: `${preset.mode === 'parametric' ? 'Parametric' : 'Equation'}${preset.evolves ? ' · evolves over time' : ''}`,
      keywords: [preset.equation, preset.equationX, preset.equationY].filter(Boolean).join(' '),
    })), { id: 'custom', title: 'Custom equation', hidden: true }],
    selectedId: $('Preset').value, label: 'Choose math pattern', placeholder: 'Find a shape or formula',
    filterLabel: 'Filter math patterns', listLabel: 'Math patterns', emptyText: 'No matching math patterns',
    onSelect(id) {
      $('Preset').value = id; $('Preset').dispatchEvent(new Event('change', { bubbles: true }));
      onPresetPick?.(id);
    },
  });
  picker.element.classList.add('blech-math-picker');
  let disposed = false, queued = null, artwork = null, error = '', currentName = MATH_PRESETS[0].name, knobs = null;
  let thumbnailArtwork = mathPresetThumbnailArtwork(MATH_PRESETS[0]);
  const fields = ['Equation', 'EquationX', 'EquationY', 'Mode', 'DomainMin', 'DomainMax', 'YMin', 'YMax', 'XMin', 'XMax', 'Samples'];
  const noteFields = ['beats', 'width', 'gate', 'low', 'high', 'velocity'];
  const presetNotes = preset => Object.fromEntries(noteFields.map(key => [key, preset[key]]));
  let noteDefaults = presetNotes(MATH_PRESETS[0]), noteOptions = { ...noteDefaults };
  const options = () => ({ ...noteOptions, ...Object.fromEntries(fields.map(key => [key[0].toLowerCase() + key.slice(1),
    $(key).type === 'range' || $(key).type === 'number' ? $(key).value === '' ? NaN : Number($(key).value) : $(key).value])) });
  const getSettings = () => ({ ...options(), name: currentName, loop: true });
  function update(notify = true) {
    if (disposed) return;
    const parametric = $('Mode').value === 'parametric';
    $('FunctionRow').hidden = parametric; $('ParamXRow').hidden = $('ParamYRow').hidden = $('XBounds').hidden = !parametric;
    for (const input of host.querySelectorAll('input[type="range"]')) {
      const key = input.id.slice(9);
      $(`${key}Out`).value = graphBounds.includes(key) ? boundLabel(input.value) : String(Number(input.value));
    }
    try {
      artwork = mathArtwork(options()); error = artwork.notes.length ? '' : 'No notes inside these graph bounds.';
    } catch (caught) { error = caught.message; artwork = null; }
    $('Status').value = error;
    if (!error && $('Preset').value === 'custom') {
      thumbnailArtwork = mathPresetThumbnailArtwork(options());
      picker.updateEntry('custom', { ...thumbnailArtwork, hidden: false });
    }
    if (notify && onPrepare) {
      const settings = getSettings();
      onPrepare({ score: error ? null : encodeMath(settings, getTempo(), artwork), artwork: structuredClone(artwork), settings, error });
    }
  }
  function queue() {
    if ($('Preset').value !== 'custom') {
      $('Preset').value = 'custom'; currentName = 'Custom equation';
      picker.updateEntry('custom', thumbnailArtwork);
      picker.select('custom');
    }
    if (queued === null) queued = requestAnimationFrame(() => { queued = null; update(); });
  }
  for (const key of fields) on($(key), $(key).tagName === 'SELECT' ? 'change' : 'input', queue);
  for (const [id, key] of [['Width', 'width'], ['Gate', 'gate'], ['Velocity', 'velocity']]) on($(id), 'input', () => {
    noteOptions[key] = Number($(id).value); queue();
  });
  for (const key of graphBounds) on($(key), 'keydown', event => {
    if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) return;
    event.preventDefault();
    const direction = event.key === 'ArrowLeft' || event.key === 'ArrowDown' ? -1 : 1;
    const value = Math.max(-1000000, Math.min(1000000, Number($(key).value) + direction * (event.shiftKey ? .01 : .1)));
    $(key).value = String(Number(value.toFixed(3)));
    $(key).dispatchEvent(new Event('input', { bubbles: true }));
  });
  on($('Preset'), 'change', () => {
    const preset = MATH_PRESETS.find(item => item.id === $('Preset').value); if (!preset) return;
    for (const key of fields) { const value = preset[key[0].toLowerCase() + key.slice(1)]; if (value !== undefined) $(key).value = String(value); }
    noteDefaults = presetNotes(preset); noteOptions = { ...noteDefaults };
    for (const [id, key] of [['Width', 'width'], ['Gate', 'gate'], ['Velocity', 'velocity']]) $(id).value = String(noteOptions[key]);
    currentName = preset.name; picker.updateEntry('custom', { hidden: true }); picker.select(preset.id); update(); knobs?.refresh();
  });
  if (onWorkbox) on($('Workbox'), 'click', onWorkbox);
  const getScore = () => { update(false); if (error) throw new Error(error); return encodeMath(getSettings(), getTempo(), artwork); };
  const getArtwork = () => { update(false); if (error) throw new Error(error); return structuredClone(artwork); };
  function setNoteOptions(patch) {
    if (disposed) return null;
    const previous = noteOptions;
    noteOptions = { ...noteOptions };
    for (const [id, key] of [['Width', 'width'], ['Gate', 'gate'], ['Velocity', 'velocity']]) if (patch[key] !== undefined) {
      $(id).value = String(patch[key]); noteOptions[key] = Number($(id).value);
    }
    try { return getScore(); }
    catch (error) {
      noteOptions = previous;
      for (const [id, key] of [['Width', 'width'], ['Gate', 'gate'], ['Velocity', 'velocity']]) $(id).value = String(noteOptions[key]);
      update(false); throw error;
    } finally { knobs?.refresh(); }
  }
  update(); knobs = mountMixerKnobs(host, { curves: Object.fromEntries(graphBounds.map(key => [`blechMath${key}`, GRAPH_CURVE])) });
  return {
    presetControl: pickerHost,
    showFreePicker(target = host.querySelector('.blech-generator-toolbar')) {
      picker.close(); target.prepend(pickerHost);
      // The frame toolbar hides source-specific controls when another source
      // is active. Moving this picker into Free/Workbox Math must reveal it.
      pickerHost.hidden = false;
    },
    openFreePicker: () => picker.open(), closeFreePicker: () => picker.close(),
    getScore, getSettings, getArtwork, getNoteOptions: () => ({ width: noteOptions.width, gate: noteOptions.gate, velocity: noteOptions.velocity }),
    setNoteOptions, resetNoteOptions: () => setNoteOptions(noteDefaults),
    dispose() { if (disposed) return; disposed = true; events.abort(); knobs.destroy(); picker.dispose(); if (queued !== null) cancelAnimationFrame(queued); host.replaceChildren(); },
  };
}

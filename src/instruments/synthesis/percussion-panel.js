import { enhanceChooseSelect } from './choose.js';
import { createKnobControl } from './controls.js';
import { PERCUSSION_METHODS, getPercussionMethod, createPercussionState, sanitizePercussionState,
  applyPercussionKit, applyPercussionRhythm, randomizePercussionKit, randomizePercussionRhythm } from './percussion-state.js';

export const DRUM_KEYS = ['KeyA', 'KeyS', 'KeyD', 'KeyF', 'KeyG', 'KeyH', 'KeyJ', 'KeyK'];
export const DRUM_MIDI_NOTES = [36, 38, 42, 46, 45, 50, 39, 51];
const names = ['Kick', 'Snare', 'Closed hat', 'Open hat', 'Low tom', 'High tom', 'Clap', 'Metal'];
const parameters = {
  frequency: ['Pitch', 20, 8000, 'Hz', 'log'], decay: ['Decay', .03, 3, 's', 'log'],
  tone: ['Brightness', 0, 1, '', 'linear'], noise: ['Noise / body', 0, 1, '', 'linear'],
  sweep: ['Pitch sweep', -24, 48, 'st', 'linear'], ratio: ['FM ratio', .125, 16, '', 'log'],
  index: ['FM depth', 0, 20, '', 'linear'], level: ['Level', 0, 1, '', 'linear'], pan: ['Pan', -1, 1, '', 'linear'],
};
const modelLabels = [
  { tone: 'Overtones', noise: 'Noise' },
  { tone: 'Metal mix', noise: 'Noise level' },
  { tone: 'Partial decay', noise: 'Strike noise' },
  { tone: 'Noise color', noise: 'Noise level', frequency: 'Carrier pitch' },
  { tone: 'Material', noise: 'Impact noise', decay: 'Ring time' },
  { tone: 'Low-pass', frequency: 'Playback pitch', noise: 'Noise layer' },
];
const arrow = '<span aria-hidden="true">▶</span>';
const dice = '<svg viewBox="0 0 24 24" aria-hidden="true"><use href="#synthesisDice"/></svg>';
const picker = (id, label, random = true) => `<div class="synthesis-axis-field"><label for="${id}">${label}</label><div class="synthesis-axis-control"><select id="${id}"></select><span class="synthesis-axis-actions"><button type="button" id="${id}Next" class="instrument-picker-next" aria-label="Next ${label.toLowerCase()}">${arrow}</button>${random ? `<button type="button" id="${id}Random" class="instrument-picker-next synthesis-parameter-random" aria-label="Randomize ${label.toLowerCase()} parameters">${dice}</button>` : ''}</span></div></div>`;

/** Owns musical editing only. Audio, clock and consent belong to the host. */
export function mountPercussionPanel(root, { change = () => {}, hit = () => {} } = {}) {
  let state = createPercussionState(), controls = [], controlsKey = '', undo = [], drag = null, cursor = -1;
  const events = new AbortController();
  const listen = (target, type, callback) => target.addEventListener(type, callback, { signal: events.signal });
  root.innerHTML = `<div class="synthesis-axis-pair">${picker('drumMethod', 'Drum synthesis method', false)}${picker('drumKit', 'Kit preset')}</div>
    <div class="synthesis-drum-header"><button type="button" class="synthesis-info" popovertarget="drumInfo" aria-label="About this drum synthesis method">i</button><span id="drumVoiceName"></span><span class="synthesis-drum-hint">Pads · A S D F G H J K</span></div>
    <div class="synthesis-drum-pads" role="group" aria-label="Drum pads"></div><div class="synthesis-drum-knobs" aria-label="Selected drum controls"></div>
    <div class="synthesis-drum-rhythm">${picker('drumRhythm', 'Rhythm preset')}<div id="drumSwingHost"></div><button type="button" id="drumUndo" disabled>Undo steps</button><button type="button" id="drumClear">Clear steps</button></div>
    <div class="synthesis-drum-grid-scroll"><div class="synthesis-drum-grid" role="group" aria-label="Sixteen-step drum rhythm"></div></div>
    <section id="drumInfo" class="synthesis-info-popup" popover><h2></h2><p></p><p>These are original technique studies, not hardware emulations or factory kits. Click or drag steps to paint a rhythm; Shift paints accents, Alt paints soft hits. Each sound has its own decay, not a shared ADSR. Sound edits apply to the next strike; ringing hits keep their original settings. PCM decay shapes playback but cannot extend the recorded one-shot.</p><a href="synthesaurus-reference.html#percussion">History &amp; sources ↗</a></section>`;
  const $ = id => root.querySelector('#' + id);
  const methodSelect = $('drumMethod'), kitSelect = $('drumKit'), rhythmSelect = $('drumRhythm');
  const padHost = root.querySelector('.synthesis-drum-pads'), grid = root.querySelector('.synthesis-drum-grid');
  const knobHost = root.querySelector('.synthesis-drum-knobs');
  const pads = [], cells = [];
  methodSelect.replaceChildren(...PERCUSSION_METHODS.map(method => new Option(`${method.label} (${method.date})`, method.id)));
  const choosers = [methodSelect, kitSelect, rhythmSelect].map(select => enhanceChooseSelect(select, { label: select.labels?.[0]?.textContent || select.id }));
  const swing = createKnobControl({ id: 'drumSwing', label: 'Swing', min: 0, max: 45, step: 1, unit: '%', value: 0,
    onInput: value => { state.swing = value / 100; state.rhythmId = 'custom'; commit({ rhythm: true }); } });
  $('drumSwingHost').append(swing);

  function commit(options = {}) { state = sanitizePercussionState(state); render(); change(structuredClone(state), options); }
  function strike(lane, velocity = .8) {
    state.selectedLane = lane; render(); hit(lane, velocity);
    pads[lane].animate?.([{ filter: 'brightness(2)' }, { filter: 'brightness(1)' }], { duration: 140 });
  }
  for (let lane = 0; lane < 8; lane++) {
    const pad = document.createElement('button'); pad.type = 'button';
    pad.className = 'synthesis-drum-pad'; pad.dataset.lane = lane;
    pad.innerHTML = `<span>${names[lane]}</span><small>${DRUM_KEYS[lane].slice(3)}</small>`;
    pad.setAttribute('aria-label', `${names[lane]} pad, key ${DRUM_KEYS[lane].slice(3)}`);
    listen(pad, 'pointerdown', event => { if (event.button !== 0) return; event.preventDefault(); pad.focus({ preventScroll: true }); strike(lane, event.pointerType === 'pen' ? Math.max(.15, event.pressure) : .8); });
    listen(pad, 'click', event => { if (event.detail === 0) strike(lane); });
    pads.push(pad); padHost.append(pad);
    const label = document.createElement('button'); label.type = 'button'; label.className = 'synthesis-drum-lane'; label.textContent = names[lane];
    listen(label, 'click', () => { state.selectedLane = lane; render(); }); grid.append(label);
    cells[lane] = [];
    for (let step = 0; step < 16; step++) {
      const cell = document.createElement('button'); cell.type = 'button'; cell.className = 'synthesis-drum-step';
      cell.dataset.lane = lane; cell.dataset.step = step; cell.tabIndex = lane === 0 && step === 0 ? 0 : -1;
      cell.setAttribute('aria-label', `${names[lane]}, step ${step + 1}`);
      listen(cell, 'click', event => {
        if (event.detail !== 0) return;
        remember(); state.steps[lane][step] = state.steps[lane][step] ? 0 : event.shiftKey ? 1 : .75;
        state.rhythmId = 'custom'; commit({ rhythm: true });
      });
      listen(cell, 'keydown', event => {
        if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) return;
        event.preventDefault(); const nextLane = (lane + (event.key === 'ArrowDown' ? 1 : event.key === 'ArrowUp' ? 7 : 0)) % 8;
        const nextStep = (step + (event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? 15 : 0)) % 16;
        grid.querySelector('[tabindex="0"]')?.setAttribute('tabindex', '-1');
        cells[nextLane][nextStep].tabIndex = 0; cells[nextLane][nextStep].focus();
      });
      cells[lane].push(cell); grid.append(cell);
    }
  }
  function remember() { undo.push({ steps: structuredClone(state.steps), rhythmId: state.rhythmId, swing: state.swing }); if (undo.length > 32) undo.shift(); }
  function paintCell(lane, step) { state.steps[lane][step] = drag.value; }
  function paintTo(lane, step) {
    const count = Math.max(Math.abs(lane - drag.lane), Math.abs(step - drag.step), 1);
    for (let i = 0; i <= count; i++) paintCell(Math.round(drag.lane + (lane - drag.lane) * i / count), Math.round(drag.step + (step - drag.step) * i / count));
    drag.lane = lane; drag.step = step; state.rhythmId = 'custom'; commit({ rhythm: true });
  }
  listen(grid, 'pointerdown', event => {
    const cell = event.target.closest('.synthesis-drum-step'); if (!cell || event.button !== 0) return;
    event.preventDefault(); cell.focus({ preventScroll: true }); remember();
    const lane = Number(cell.dataset.lane), step = Number(cell.dataset.step);
    drag = { id: event.pointerId, lane, step, value: event.shiftKey ? 1 : event.altKey ? .35 : state.steps[lane][step] ? 0 : .75 };
    grid.setPointerCapture(event.pointerId); paintTo(lane, step);
  });
  listen(grid, 'pointermove', event => {
    if (!drag || drag.id !== event.pointerId) return;
    const cell = document.elementFromPoint(event.clientX, event.clientY)?.closest('.synthesis-drum-step');
    if (cell && grid.contains(cell)) paintTo(Number(cell.dataset.lane), Number(cell.dataset.step));
  });
  for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) listen(grid, type, () => { drag = null; });
  listen($('drumUndo'), 'click', () => { const previous = undo.pop(); if (previous) { Object.assign(state, previous); commit({ rhythm: true }); } });
  listen($('drumClear'), 'click', () => { remember(); state.steps = Array.from({ length: 8 }, () => Array(16).fill(0)); state.rhythmId = 'custom'; commit({ rhythm: true }); });
  const next = select => { const options = [...select.options].filter(option => option.value !== 'custom'); const index = options.findIndex(option => option.value === select.value); select.value = options[(index + 1) % options.length].value; select.dispatchEvent(new Event('change', { bubbles: true })); };
  listen(methodSelect, 'change', () => {
    const next = createPercussionState(methodSelect.value);
    state = { ...next, steps: state.steps, rhythmId: 'custom', swing: state.swing, selectedLane: state.selectedLane };
    commit();
  });
  listen(kitSelect, 'change', () => { state = applyPercussionKit(state, kitSelect.value); commit(); });
  listen(rhythmSelect, 'change', () => { remember(); state = applyPercussionRhythm(state, rhythmSelect.value); commit({ rhythm: true }); });
  for (const select of [methodSelect, kitSelect, rhythmSelect]) listen($(select.id + 'Next'), 'click', () => next(select));
  listen($('drumKitRandom'), 'click', () => { state = randomizePercussionKit(state); commit(); });
  listen($('drumRhythmRandom'), 'click', () => { remember(); state = randomizePercussionRhythm(state); commit({ rhythm: true }); });

  function render() {
    const method = getPercussionMethod(state.methodId);
    methodSelect.value = method.id;
    for (const [select, values, selected] of [[kitSelect, method.kits, state.kitId], [rhythmSelect, method.rhythms, state.rhythmId]]) {
      select.replaceChildren(...(!values.some(value => value.id === selected) ? [new Option('Custom', 'custom')] : []), ...values.map(value => new Option(value.label, value.id)));
      select.value = selected;
    }
    choosers.forEach(chooser => chooser?.refresh());
    $('drumInfo').querySelector('h2').textContent = `${method.label} (${method.date})`;
    $('drumInfo').querySelector('p').textContent = method.description;
    $('drumVoiceName').textContent = names[state.selectedLane];
    pads.forEach((pad, lane) => pad.setAttribute('aria-pressed', String(lane === state.selectedLane)));
    cells.forEach((row, lane) => row.forEach((cell, step) => {
      const value = state.steps[lane][step]; cell.setAttribute('aria-pressed', String(value > 0));
      cell.style.setProperty('--hit-velocity', value); cell.classList.toggle('is-accent', value >= .95);
      cell.title = `${names[lane]} · ${step + 1} · ${value ? Math.round(value * 100) + '%' : 'off'}`;
    }));
    const voice = state.voices[state.selectedLane], key = `${method.id}:${state.selectedLane}:${voice.model}`;
    if (key !== controlsKey) {
      controls.forEach(control => control.destroy()); controls = []; knobHost.replaceChildren(); controlsKey = key;
      for (const name of [...new Set([...method.controls, 'level', 'pan'])]) {
        if ((name === 'ratio' || name === 'index') && voice.model !== 3) continue;
        const definition = parameters[name]; if (!definition) continue;
        const [defaultLabel, min, max, unit, scale] = definition;
        const label = modelLabels[voice.model]?.[name] || defaultLabel;
        const control = createKnobControl({ id: 'drum-' + name, label, min, max, unit, scale, value: voice[name],
          step: name === 'frequency' ? 1 : .01,
          onInput: value => { state.voices[state.selectedLane][name] = value; state.kitId = 'custom'; commit(); } });
        control.drumParameter = name; controls.push(control); knobHost.append(control);
      }
    } else controls.forEach(control => control.setValue(voice[control.drumParameter]));
    swing.setValue(state.swing * 100); $('drumUndo').disabled = !undo.length;
  }
  render();
  return {
    getState: () => structuredClone(state),
    setValue(value) { state = sanitizePercussionState(value); undo = []; render(); },
    hit: strike,
    progress(step) {
      const next = Number.isInteger(step) ? step : -1; if (next === cursor) return;
      cursor = next; cells.forEach(row => row.forEach((cell, index) => cell.classList.toggle('is-current', index === cursor)));
    },
    destroy() { events.abort(); controls.forEach(control => control.destroy()); swing.destroy(); choosers.forEach(control => control?.destroy()); },
  };
}

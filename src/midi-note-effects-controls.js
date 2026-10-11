import { DEFAULT_MIDI_NOTE_EFFECTS, sanitizeMidiNoteEffects } from './midi-note-effects.js';
import { enhanceRangeKnob } from './ui/primitives/range-knob.js';

/** A shared editor; the instrument owns the clock, notes and effects state. */
export function mountMidiNoteEffectEditor(host, { id = 'midiNoteFx', getValue, onChange }) {
  const doc = host.ownerDocument, events = new AbortController(), knobs = [];
  const definitions = [
    ['transpose', 'Transpose', -24, 24, 1, value => `${value > 0 ? '+' : ''}${value} st`],
    ['velocity', 'Velocity', .25, 2, .01, value => `${Math.round(value * 100)}%`],
    ['delayBeats', 'Note delay', 0, 1, .0625, value => `${value} beats`],
    ['gateBeats', 'Gate limit', 0, 4, .0625, value => value ? `${value} beats` : 'Natural'],
    ['echoCount', 'Echoes', 0, 4, 1, String],
    ['echoBeats', 'Echo spacing', .0625, 4, .0625, value => `${value} beats`],
    ['echoDecay', 'Echo velocity', .1, .9, .01, value => `${Math.round(value * 100)}%`],
  ];
  const section = doc.createElement('details'); section.className = 'midi-note-effects';
  section.innerHTML = `<summary>MIDI effects <output data-fx-status>Bypassed</output></summary>
    <div class="midi-note-effects-actions"><label><input id="${id}Enabled" data-fx="enabled" type="checkbox"> MIDI effects on</label><button type="button" class="mini-action" data-fx-reset>Reset</button></div>
    <div class="midi-note-effects-fields"><label class="control"><span><b>Chord</b></span><select id="${id}Chord" data-fx="chord" aria-label="MIDI chord"><option value="single">Single note</option><option value="octave">Octave</option><option value="fifth">Fifth</option><option value="major">Major triad</option><option value="minor">Minor triad</option></select></label>
    ${definitions.map(([key, label, min, max, step]) => `<label class="control"><span><b>${label}</b><output data-fx-out="${key}"></output></span><span class="midi-note-effects-knob"><input id="${id}${key[0].toUpperCase()}${key.slice(1)}" data-fx="${key}" data-midi-note-effect type="range" min="${min}" max="${max}" step="${step}" aria-label="MIDI ${label.toLowerCase()}"></span></label>`).join('')}</div>
    <label class="midi-note-effects-drums"><input id="${id}Drums" data-fx="drums" type="checkbox"> Transpose &amp; harmonize drums too</label>
    <p class="midi-note-effects-help">Changes shape new notes. Timing follows tempo; gate limits key length. Bypass keeps playback moving.</p>`;
  host.append(section);
  const inputs = [...section.querySelectorAll('[data-fx]')];
  let signature = '';
  function refresh() {
    const state = sanitizeMidiNoteEffects(getValue());
    const next = JSON.stringify(state); if (next === signature) return; signature = next;
    for (const input of inputs) {
      if (input.type === 'checkbox') input.checked = state[input.dataset.fx];
      else input.value = state[input.dataset.fx];
    }
    for (const [key, , , , , format] of definitions) section.querySelector(`[data-fx-out="${key}"]`).value = format(state[key]);
    section.querySelector('[data-fx-status]').value = state.enabled ? 'On' : 'Bypassed';
    section.dataset.enabled = String(state.enabled);
    for (const knob of knobs) knob.update();
  }
  for (const input of inputs) {
    if (input.type === 'range') knobs.push(enhanceRangeKnob(input));
    input.addEventListener(input.type === 'range' ? 'input' : 'change', () => {
      const value = input.type === 'checkbox' ? input.checked : input.type === 'range' ? Number(input.value) : input.value;
      onChange(sanitizeMidiNoteEffects({ ...getValue(), [input.dataset.fx]: value })); refresh();
    }, { signal: events.signal });
  }
  section.querySelector('[data-fx-reset]').addEventListener('click', () => { onChange({ ...DEFAULT_MIDI_NOTE_EFFECTS }); refresh(); }, { signal: events.signal });
  refresh();
  return { refresh, destroy() { events.abort(); for (const knob of knobs) knob.destroy(); section.remove(); } };
}

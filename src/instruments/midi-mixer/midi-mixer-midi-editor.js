import { GM_PROGRAM_NAMES } from './midi-mixer-model.js';
import { MIDI_PARAMETER_FIELDS, MIDI_CC_PARAMETERS, MIDI_GENERATOR_PARAMETERS, MIDI_SYNTH_EFFECT_PARAMETERS } from './midi-mixer-parameters.js';

let nextEditorId = 0;
const own = (value, key) => Object.prototype.hasOwnProperty.call(value ?? {}, key);
const entries = value => Array.isArray(value) ? value : Object.values(value ?? {});
const commonControllers = new Set([1, 7, 10, 11, 64, 65, 66, 67, 71, 72, 73, 74, 75, 76, 77, 78, 91, 93]);

/** Native controls only. The caller owns MIDI state, synthesis and transport. */
export function mountMidiParameterEditor(host, { label = 'MIDI sound', getValue = () => ({}), onChange, onAction, followLabel = 'Follow file', excludeFields = [] } = {}) {
  return mountEditor(host, { label, getValue, onChange, onAction, followLabel, excludeFields });
}

/** The SoundFont's shared effect processors, separate from the mixer echo. */
export function mountMidiSynthEffectEditor(host, { label = 'SoundFont effects', getValue = () => ({}), onChange, followLabel = 'SoundFont default' } = {}) {
  return mountEditor(host, { label, getValue, onChange, followLabel, effects: true, excludeFields: [] });
}

function mountEditor(host, options) {
  const document = host.ownerDocument, prefix = `midi-edit-${++nextEditorId}`, listeners = new AbortController();
  const { label, getValue, onChange, onAction, followLabel, effects = false, excludeFields } = options;
  const refreshers = [], fieldListeners = new Set(), excluded = new Set(excludeFields);
  let destroyed = false, controlCount = 0, currentValue = getValue() ?? {};
  const el = (tag, className, text) => { const node = document.createElement(tag); if (className) node.className = className; if (text != null) node.textContent = text; return node; };
  const on = (node, type, callback) => node.addEventListener(type, callback, { signal: listeners.signal });
  const root = el('div', 'midi-parameter-editor'); root.setAttribute('aria-label', label); host.append(root);
  const toolbar = el('div', 'midi-edit-toolbar'), count = el('output', 'midi-edit-count');
  const reset = el('button', 'midi-edit-reset', 'Reset all'); reset.type = 'button'; reset.setAttribute('aria-label', `Reset ${label}`);
  toolbar.append(count, reset); root.append(toolbar);
  on(reset, 'click', () => commit(null));

  const valueAt = (descriptor, map) => map ? currentValue?.[map]?.[descriptor.id] : currentValue?.[descriptor.id];
  const hasValue = (descriptor, map) => map ? own(currentValue?.[map], descriptor.id) : own(currentValue, descriptor.id);
  const patch = (descriptor, map, value) => map ? { [map]: { [descriptor.id]: value } } : { [descriptor.id]: value };
  function commit(value) { onChange?.(value); refresh(); }
  function display(value, descriptor) {
    if (typeof value === 'boolean') return value ? 'On' : 'Off';
    const number = Number(value); if (!Number.isFinite(number)) return String(value ?? '');
    const decimals = descriptor.step && descriptor.step < 1 ? Math.min(4, Math.ceil(-Math.log10(descriptor.step))) : 0;
    let result = `${number.toFixed(decimals).replace(/(\.\d*?[1-9])0+$|\.0+$/, '$1')}${descriptor.unit ? ` ${descriptor.unit}` : ''}`;
    if (descriptor.unit === 'timecents') {
      const seconds = number <= -32768 ? 0 : 2 ** (number / 1200);
      result += seconds < 1 ? ` · ${Number((seconds * 1000).toPrecision(3))} ms` : ` · ${Number(seconds.toPrecision(3))} s`;
    } else if (descriptor.unit === 'cents' && [8, 22, 24].includes(Number(descriptor.id))) {
      result += ` · ${Number((440 * 2 ** ((number - 6900) / 1200)).toPrecision(4))} Hz`;
    }
    return result;
  }
  function updateInput(input, value) {
    if (input.type === 'checkbox') { input.checked = Boolean(value); return; }
    // Do not replace partial number entry or interrupt a held range gesture.
    if (!(input.type === 'number' && document.activeElement === input) && input.value !== String(value)) input.value = String(value);
  }
  function makeControl(descriptor, map = null, { action = false } = {}) {
    const controlEvents = new AbortController(); fieldListeners.add(controlEvents);
    const fieldOn = (node, type, callback) => node.addEventListener(type, callback, { signal: controlEvents.signal });
    const field = el('div', 'midi-edit-field'), id = `${prefix}-field-${controlCount++}`, heading = el('div', 'midi-edit-field-heading');
    const title = el('label', '', descriptor.label ?? String(descriptor.id)); title.htmlFor = id;
    const output = el('output'); output.htmlFor = id;
    heading.append(title, output); field.append(heading);
    const row = el('div', 'midi-edit-value-row');
    const numericToggle = !map && ['mono', 'drums'].includes(descriptor.id);
    const toggle = numericToggle || typeof descriptor.default === 'boolean' || descriptor.type === 'boolean';
    let input, number;
    if (toggle) {
      input = el('input'); input.type = 'checkbox';
    } else if (!map && descriptor.id === 'program') {
      input = el('select'); GM_PROGRAM_NAMES.forEach((name, index) => input.add(new Option(`${index + 1} · ${name}`, String(index))));
    } else {
      input = el('input'); input.type = 'range';
      number = el('input', 'midi-edit-number'); number.type = 'number'; number.setAttribute('aria-label', `${label}: ${descriptor.label}, exact value`);
      for (const node of [input, number]) { node.min = String(descriptor.min); node.max = String(descriptor.max); node.step = String(descriptor.step ?? 1); }
    }
    input.id = id; input.setAttribute('aria-label', `${label}: ${descriptor.label}`);
    row.append(input); if (number) row.append(number);
    const clear = el('button', 'midi-edit-follow', action ? 'Send' : followLabel); clear.type = 'button';
    clear.setAttribute('aria-label', `${label}: ${descriptor.label}, ${action ? 'send MIDI controller' : followLabel.toLowerCase()}`);
    row.append(clear); field.append(row);
    if (descriptor.description) { const hint = el('small', 'midi-edit-description', descriptor.description); hint.id = `${id}-help`; input.setAttribute('aria-describedby', hint.id); if (number) number.setAttribute('aria-describedby', hint.id); field.append(hint); }
    let local = descriptor.default ?? descriptor.min ?? 0;
    function read(node) {
      if (toggle) return numericToggle ? Number(node.checked) : node.checked;
      if (node.value === '' || !Number.isFinite(Number(node.value))) return null;
      const minimum = Number(descriptor.min ?? 0), maximum = Number(descriptor.max ?? 127);
      const step = Number(descriptor.step ?? 1), value = Math.max(minimum, Math.min(maximum, Number(node.value)));
      return Math.max(minimum, Math.min(maximum, Math.round(value / step) * step));
    }
    function changed(node) {
      const value = read(node); if (value === null) return;
      local = value;
      if (number && node !== number) updateInput(number, value);
      if (node !== input) updateInput(input, value);
      if (action) output.value = display(value, descriptor); else commit(patch(descriptor, map, value));
    }
    fieldOn(input, input.tagName === 'SELECT' || toggle ? 'change' : 'input', () => changed(input));
    if (number) { fieldOn(number, 'input', () => changed(number)); fieldOn(number, 'change', () => { changed(number); number.value = String(local); }); }
    fieldOn(clear, 'click', () => action ? onAction?.({ kind: 'cc', controller: Number(descriptor.id), value: Number(local) }) : commit(patch(descriptor, map, null)));
    function reflect() {
      const overridden = hasValue(descriptor, map), value = action ? local : overridden ? valueAt(descriptor, map) : descriptor.default ?? descriptor.min ?? 0;
      local = value; updateInput(input, value); if (number) updateInput(number, value);
      output.value = action || overridden ? toggle ? value ? 'On' : 'Off' : display(value, descriptor) : followLabel;
      field.classList.toggle('is-overridden', overridden);
      if (!action) clear.disabled = !overridden;
    }
    reflect();
    return { field, reflect, destroy() { controlEvents.abort(); fieldListeners.delete(controlEvents); } };
  }
  function disclosure(title, build) {
    const details = el('details', 'midi-edit-group'), summary = el('summary', '', title), body = el('div', 'midi-edit-group-body');
    details.append(summary, body); root.append(details);
    let built = false;
    on(details, 'toggle', () => { if (details.open && !built) { built = true; build(body); refresh(); } });
    return details;
  }
  function fields(title, descriptors, map = null) {
    disclosure(title, body => {
      const grid = el('div', 'midi-edit-grid'); body.append(grid);
      for (const descriptor of descriptors) { const control = makeControl(descriptor, map); grid.append(control.field); refreshers.push(control.reflect); }
    });
  }

  const scalarGroups = new Map();
  for (const descriptor of entries(effects ? MIDI_SYNTH_EFFECT_PARAMETERS : MIDI_PARAMETER_FIELDS)) {
    if (excluded.has(descriptor.id)) continue;
    const group = descriptor.group || (effects ? 'Effects' : 'Sound');
    if (!scalarGroups.has(group)) scalarGroups.set(group, []);
    scalarGroups.get(group).push(descriptor);
  }
  for (const [group, descriptors] of scalarGroups) fields(group, descriptors);

  function bank(title, descriptors, map, placeholder, note) {
    disclosure(title, body => {
      const searchId = `${prefix}-${map}-search`, searchLabel = el('label', 'sr-only', `Find ${title.toLowerCase()}`), search = el('input', 'midi-edit-search');
      searchLabel.htmlFor = searchId; search.id = searchId; search.type = 'search'; search.placeholder = placeholder; search.autocomplete = 'off';
      const results = el('div', 'midi-edit-results'); results.setAttribute('role', 'group'); results.setAttribute('aria-label', title);
      const selectedHost = el('div', 'midi-edit-selected'), active = el('div', 'midi-edit-active'); active.setAttribute('aria-label', `Active ${title.toLowerCase()} overrides`);
      body.append(searchLabel, search); if (note) body.append(el('p', 'midi-edit-note', note)); body.append(results, selectedHost, active);
      let selectedControl = null, activeSignature = '';
      const items = [];
      function select(descriptor) {
        if (!descriptor) return;
        selectedControl?.destroy(); selectedHost.replaceChildren();
        selectedControl = makeControl(descriptor, map, { action: Boolean(descriptor.procedural) }); selectedHost.append(selectedControl.field);
        for (const item of items) item.button.setAttribute('aria-pressed', String(item.descriptor.id === descriptor.id));
      }
      for (const descriptor of descriptors) {
        const button = el('button', 'midi-edit-result', descriptor.label); button.type = 'button'; button.setAttribute('aria-pressed', 'false');
        button.dataset.parameter = String(descriptor.id); button.dataset.map = map;
        on(button, 'click', () => select(descriptor)); results.append(button); items.push({ button, descriptor });
      }
      const empty = el('span', 'midi-edit-empty', 'No matching parameters'); empty.hidden = true; results.append(empty);
      on(search, 'input', () => {
        const words = search.value.trim().toLowerCase().split(/\s+/).filter(Boolean); let visible = 0;
        for (const { button, descriptor } of items) { const text = `${descriptor.id} ${descriptor.label} ${descriptor.group ?? ''} ${descriptor.description ?? ''}`.toLowerCase(); button.hidden = !words.every(word => text.includes(word)); if (!button.hidden) visible++; }
        empty.hidden = visible !== 0;
      });
      function reflect() {
        selectedControl?.reflect();
        const value = currentValue?.[map] ?? {}, signature = JSON.stringify(value);
        if (signature === activeSignature) return; activeSignature = signature; active.replaceChildren();
        for (const [id, amount] of Object.entries(value)) {
          const descriptor = descriptors.find(item => String(item.id) === id); if (!descriptor) continue;
          const row = el('div', 'midi-edit-active-row'), choose = el('button', 'midi-edit-active-label', `${descriptor.label}: ${display(amount, descriptor)}`), remove = el('button', 'midi-edit-follow', followLabel);
          choose.type = remove.type = 'button'; remove.setAttribute('aria-label', `${label}: ${descriptor.label}, ${followLabel.toLowerCase()}`);
          choose.dataset.parameter = remove.dataset.parameter = id; remove.dataset.remove = 'true'; row.append(choose, remove); active.append(row);
        }
      }
      on(active, 'click', event => { const button = event.target.closest('button[data-parameter]'); if (!button || !active.contains(button)) return; const descriptor = descriptors.find(item => String(item.id) === button.dataset.parameter); if (!descriptor) return; if (button.dataset.remove) commit(patch(descriptor, map, null)); else select(descriptor); });
      refreshers.push(reflect); select(descriptors.find(descriptor => Number(descriptor.id) === (map === 'controllers' ? 7 : 8)) ?? descriptors[0]); reflect();
    });
  }
  if (!effects) {
    const controllers = entries(MIDI_CC_PARAMETERS).filter(descriptor => !descriptor.procedural || onAction);
    fields('Expression & pedals', controllers.filter(descriptor => commonControllers.has(Number(descriptor.id))), 'controllers');
    bank('All MIDI controllers', controllers, 'controllers', 'Find CC number, pan, sustain, expression…', 'Edits override the file until you choose Follow file. Some controllers depend on the SoundFont.');
    bank('SoundFont synthesis', entries(MIDI_GENERATOR_PARAMETERS), 'generators', 'Find envelope, filter, LFO, tuning…', 'Overrides the instrument’s SoundFont generators. Envelope and sample settings may take effect on new notes.');
    if (onAction) disclosure('RPN / NRPN & recovery', body => {
      const form = el('form', 'midi-edit-rpn'), kind = el('select'), parameter = el('input'), value = el('input'), send = el('button', '', 'Send parameter');
      kind.add(new Option('RPN · registered parameter', 'rpn')); kind.add(new Option('NRPN · nonregistered parameter', 'nrpn'));
      kind.setAttribute('aria-label', `${label}: parameter type`);
      for (const [input, name] of [[parameter, 'Parameter number'], [value, 'Parameter value']]) { const text = el('label', '', name); input.type = 'number'; input.min = '0'; input.max = '16383'; input.step = '1'; input.value = '0'; input.required = true; input.setAttribute('aria-label', `${label}: ${name.toLowerCase()}`); text.append(input); form.append(text); }
      form.prepend(kind); send.type = 'submit'; form.append(send); body.append(el('p', 'midi-edit-note', 'Send an ordered MIDI parameter message. Support depends on the receiving SoundFont engine; file automation can change it again.'), form);
      on(form, 'submit', event => { event.preventDefault(); if (form.checkValidity()) onAction({ kind: 'parameter', registered: kind.value === 'rpn', parameter: Number(parameter.value), value: Number(value.value) }); });
      const actions = el('div', 'midi-edit-recovery');
      for (const [controller, title] of [[64, 'Release sustain'], [123, 'All notes off'], [120, 'All sound off'], [121, 'Reset MIDI controllers']]) {
        const button = el('button', '', title); button.type = 'button'; on(button, 'click', () => onAction({ kind: 'cc', controller, value: 0 })); actions.append(button);
      }
      body.append(actions);
    });
  }

  function refresh() {
    if (destroyed) return;
    currentValue = getValue() ?? {};
    const total = Object.entries(currentValue).reduce((sum, [key, value]) => sum + (key === 'controllers' || key === 'generators' ? Object.keys(value ?? {}).length : value == null ? 0 : 1), 0);
    count.value = total ? `${total} edit${total === 1 ? '' : 's'}` : followLabel;
    reset.disabled = total === 0;
    for (const reflect of refreshers) reflect();
  }
  refresh();
  return { refresh, destroy() { if (destroyed) return; destroyed = true; listeners.abort(); for (const controller of fieldListeners) controller.abort(); fieldListeners.clear(); refreshers.length = 0; root.remove(); } };
}

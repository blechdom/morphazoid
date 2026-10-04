import { PROCESSOR_METHODS, getMethod, stateFromPreset, sanitizeState } from './catalog.js';
import { createParameterControl } from './controls.js';
import { enhanceChooseSelect } from './choose.js';
import { createMethodGestureEditor, METHOD_EDITOR_SCHEMAS, groupMethodControls } from './method-ui.js';

/** One processor editor, shared by synth inserts and external audio inputs. */
export function createProcessorPanel(host, initial, onChange) {
  const doc = host.ownerDocument;
  let state = sanitizeState(initial), fields = [], gesture = null, builtMethod = null;
  let lastFactory = { methodId: state.methodId, presetId: state.presetId };
  const listeners = new AbortController();
  const listen = (el, event, fn) => el.addEventListener(event, fn, { signal: listeners.signal });
  host.innerHTML = `<div class="synthesis-axis-pair">
    <div class="synthesis-axis-field"><div class="synthesis-axis-heading"><label for="processorMethod">Processor</label><button class="synthesis-info" type="button" popovertarget="processorInfo" aria-label="About this processor">i</button></div><div class="synthesis-axis-control"><select id="processorMethod"></select><button type="button" id="nextProcessor" aria-label="Next processor">▶</button></div></div>
    <div class="synthesis-axis-field"><label for="processorPreset">Processor preset</label><div class="synthesis-axis-control"><select id="processorPreset"></select><button type="button" id="nextProcessorPreset" aria-label="Next processor preset">▶</button></div></div>
  </div><div class="synthesis-method-editor" id="processorEditor"></div><div id="processorParameters" class="synthesis-parameters"></div>`;
  const methodSelect = host.querySelector('#processorMethod'), presetSelect = host.querySelector('#processorPreset');
  methodSelect.replaceChildren(...PROCESSOR_METHODS.map(method => new Option(method.label, method.id)));
  const methodPicker = enhanceChooseSelect(methodSelect, { label: 'Choose processor' });
  const presetPicker = enhanceChooseSelect(presetSelect, { label: 'Choose processor preset' });
  const editorHost = host.querySelector('#processorEditor'), parametersHost = host.querySelector('#processorParameters');
  function changed(next, audition = false) { state = sanitizeState(next); render(); onChange(state, { audition }); }
  function edit(index, value) { changed({ ...state, presetId: 'custom', params: state.params.map((old, at) => at === index ? value : old) }); }
  listen(methodSelect, 'change', () => changed(stateFromPreset(methodSelect.value, null, state), true));
  listen(presetSelect, 'change', () => { if (presetSelect.value !== 'custom') changed(stateFromPreset(state.methodId, presetSelect.value, state), true); });
  listen(host.querySelector('#nextProcessor'), 'click', () => changed(stateFromPreset(PROCESSOR_METHODS[(PROCESSOR_METHODS.findIndex(m => m.id === state.methodId) + 1) % PROCESSOR_METHODS.length].id, null, state), true));
  listen(host.querySelector('#nextProcessorPreset'), 'click', () => {
    const method = getMethod(state.methodId);
    const current = state.presetId === 'custom' && lastFactory.methodId === method.id ? lastFactory.presetId : state.presetId;
    const at = method.presets.findIndex(p => p.id === current);
    changed(stateFromPreset(method.id, method.presets[(at + 1) % method.presets.length].id, state), true);
  });
  function render() {
    const method = getMethod(state.methodId);
    if (state.presetId !== 'custom') lastFactory = { methodId: state.methodId, presetId: state.presetId };
    methodSelect.value = method.id; methodPicker.refresh();
    presetSelect.replaceChildren(...(state.presetId === 'custom' ? [new Option('Custom settings', 'custom')] : []), ...method.presets.map(p => new Option(p.name, p.id)));
    presetSelect.value = state.presetId; presetPicker.refresh();
    if (builtMethod !== method.id) {
      fields.forEach(field => field?.destroy()); gesture?.destroy();
      builtMethod = method.id;
      const graphical = new Set((METHOD_EDITOR_SCHEMAS[method.id] || []).flatMap(item => item.kind === 'xy' ? [item.x, item.y] : item.ids));
      fields = method.controls.map((control, index) => graphical.has(control.id) ? null : createParameterControl(control, index, state.params[index], value => edit(index, value), { prefix: 'processor-param' }));
      parametersHost.replaceChildren(...groupMethodControls(method).map(group => {
        const fieldsInGroup = group.indexes.map(index => fields[index]).filter(Boolean);
        if (!fieldsInGroup.length) return null;
        const section = doc.createElement('section'); section.className = 'synthesis-parameter-group';
        const title = doc.createElement('h3'); title.textContent = group.label;
        const grid = doc.createElement('div'); grid.className = 'synthesis-parameter-group-grid'; grid.append(...fieldsInGroup);
        section.append(title, grid); return section;
      }).filter(Boolean));
      gesture = createMethodGestureEditor(editorHost, method, state.params, changes => {
        const params = [...state.params]; for (const change of changes) params[change.index] = change.value;
        changed({ ...state, presetId: 'custom', params });
      });
    }
    const mode = Math.round(state.params[0] * ((method.controls[0]?.options?.length ?? 1) - 1));
    fields.forEach((field, index) => {
      field?.setValue(state.params[index]);
      if (field) field.hidden = Array.isArray(method.controls[index].modes) && !method.controls[index].modes.includes(mode);
    });
    for (const group of parametersHost.children) group.hidden = ![...group.querySelector('.synthesis-parameter-group-grid').children].some(field => !field.hidden);
    gesture?.setValue(state.params);
  }
  render();
  return { setValue(next) { state = sanitizeState(next); render(); }, destroy() { listeners.abort(); fields.forEach(f => f?.destroy()); gesture?.destroy(); methodPicker.destroy(); presetPicker.destroy(); host.replaceChildren(); } };
}

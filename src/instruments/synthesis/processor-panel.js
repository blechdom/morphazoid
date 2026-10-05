import { PROCESSOR_METHODS, getMethod, getPreset, stateFromPreset, sanitizeState } from './catalog.js';
import { SECTION_PRESETS, fullPresetId, randomizeMethodState } from './presets.js';
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
    <div class="synthesis-axis-field"><div class="synthesis-axis-heading"><label for="processorMethod">Processor method</label><button class="synthesis-info" type="button" popovertarget="processorInfo" aria-label="About this processor">i</button></div><div class="synthesis-axis-control"><select id="processorMethod"></select><span class="synthesis-axis-actions"><button class="instrument-picker-next" type="button" id="nextProcessor" title="Next processor" aria-label="Next processor">▶</button></span></div></div>
    <div class="synthesis-axis-field"><label for="processorPreset">Processor preset</label><div class="synthesis-axis-control"><select id="processorPreset"></select><span class="synthesis-axis-actions"><button class="instrument-picker-next" type="button" id="nextProcessorPreset" title="Next processor preset" aria-label="Next processor preset">▶</button><button class="instrument-picker-next synthesis-parameter-random" type="button" id="randomProcessor" title="Randomize current processor parameters" aria-label="Randomize current processor parameters"><svg viewBox="0 0 24 24" aria-hidden="true"><use href="#synthesisDice"/></svg></button></span></div></div>
  </div><div class="synthesis-method-editor" id="processorEditor"></div><div id="processorParameters" class="synthesis-parameters"></div>`;
  const methodSelect = host.querySelector('#processorMethod'), presetSelect = host.querySelector('#processorPreset');
  methodSelect.replaceChildren(...PROCESSOR_METHODS.map(method => new Option(method.label, method.id)));
  const methodPicker = enhanceChooseSelect(methodSelect, { label: 'Choose processor' });
  const presetPicker = enhanceChooseSelect(presetSelect, { label: 'Choose processor preset' });
  const presets = SECTION_PRESETS.processing;
  const presetOptions = presets.map(preset => ({ id: preset.id,
    label: `${getPreset(preset.snapshot.methodId, preset.snapshot.presetId).name} · ${getMethod(preset.snapshot.methodId).label}`,
  }));
  const editorHost = host.querySelector('#processorEditor'), parametersHost = host.querySelector('#processorParameters');
  function changed(next, audition = false) { state = sanitizeState(next); render(); onChange(state, { audition }); }
  function edit(index, value) { changed({ ...state, presetId: 'custom', params: state.params.map((old, at) => at === index ? value : old) }); }
  listen(methodSelect, 'change', () => changed(stateFromPreset(methodSelect.value, null, state), true));
  const applyPreset = preset => {
    if (preset) changed(stateFromPreset(preset.snapshot.methodId, preset.snapshot.presetId, state), true);
  };
  listen(presetSelect, 'change', () => applyPreset(presets.find(preset => preset.id === presetSelect.value)));
  listen(host.querySelector('#randomProcessor'), 'click', () => {
    const next = randomizeMethodState(state);
    // Dice changes the selected effect, never its input source, pitch or bypass.
    changed({ ...next, source: state.source, frequencyHz: state.frequencyHz, bypass: state.bypass,
      envelope: state.envelope, levelTrimDb: state.levelTrimDb }, true);
  });
  listen(host.querySelector('#nextProcessor'), 'click', () => changed(stateFromPreset(PROCESSOR_METHODS[(PROCESSOR_METHODS.findIndex(m => m.id === state.methodId) + 1) % PROCESSOR_METHODS.length].id, null, state), true));
  listen(host.querySelector('#nextProcessorPreset'), 'click', () => {
    const current = state.presetId === 'custom' ? lastFactory : state;
    const at = presets.findIndex(preset => preset.id === fullPresetId(current.methodId, current.presetId));
    applyPreset(presets[(at + 1) % presets.length]);
  });
  function render() {
    const method = getMethod(state.methodId);
    if (state.presetId !== 'custom') lastFactory = { methodId: state.methodId, presetId: state.presetId };
    methodSelect.value = method.id; methodPicker.refresh();
    const custom = state.presetId === 'custom';
    // The combined menu stays searchable across methods, including Delay while
    // Reverb is selected. Knob edits need only toggle its optional Custom row.
    if (presetSelect.dataset.custom !== String(custom)) {
      presetSelect.replaceChildren(...(custom ? [new Option('Custom settings', 'custom')] : []),
        ...presetOptions.map(preset => new Option(preset.label, preset.id)));
      presetSelect.dataset.custom = String(custom);
    }
    presetSelect.value = custom ? 'custom' : fullPresetId(method.id, state.presetId); presetPicker.refresh();
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

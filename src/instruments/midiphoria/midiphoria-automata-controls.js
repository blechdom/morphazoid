import { AUTOMATA_MIDI_DEFAULTS, generateAutomataMidi } from './midiphoria-automata-midi.js';
import { AUTOMATAPOEIA_RULES, AUTOMATAPOEIA_TOTALISTIC_RULES, automatapoeiaPreviewRows,
  automatapoeiaRowsPath } from '../cellular-automata/automatapoeia.js';

const SVG = 'http://www.w3.org/2000/svg';
const catalogFor = family => family === 'totalistic-r2' ? AUTOMATAPOEIA_TOTALISTIC_RULES : AUTOMATAPOEIA_RULES;
const formatBeats = value => Number(Number(value).toFixed(3)).toString();

/** MIDI source controls only: previewing rules never arms Audio or starts a
 * transport. The owner chooses where the explicitly submitted score goes.
 */
export function mountAutomataMidiControls(host, { idPrefix = 'automataMidi', actionLabel = 'Make MIDI', onGenerate } = {}) {
  const document = host.ownerDocument, window = document.defaultView ?? globalThis;
  const basePrefix = String(idPrefix).replace(/[^a-zA-Z0-9_-]/g, '-') || 'automataMidi';
  let prefix = basePrefix, suffix = 1;
  while (document.getElementById(`${prefix}Family`)) prefix = `${basePrefix}-${++suffix}`;
  const listeners = new AbortController(), inputs = new Map(), tiles = new Map();
  let settings = { ...AUTOMATA_MIDI_DEFAULTS }, score = null, currentError = null, dirty = true;
  let disposed = false, previewFrame = null, url = null, ticket = 0, pending = null, busy = false, atlasFamily = null;
  const rememberedRules = new Map([[settings.family, settings.rule]]);
  const el = (tag, className, text) => { const node = document.createElement(tag); if (className) node.className = className; if (text != null) node.textContent = text; return node; };
  const on = (node, type, listener) => node.addEventListener(type, listener, { signal: listeners.signal });
  const id = (node, name) => { node.id = `${prefix}${name}`; return node; };
  const button = (name, text) => { const node = id(el('button', '', text), name); node.type = 'button'; return node; };
  const root = el('details', 'midiphoria-automata'), heading = el('summary', '', 'Automatapoeia rules'); root.append(heading);
  const body = el('div', 'automata-midi-body'), main = el('div', 'automata-midi-main'); root.append(body); body.append(main); host.append(root);

  function field(parent, name, label, key, type, options) {
    const wrapper = el('label'), title = el('span', '', label), input = id(el(type === 'select' ? 'select' : 'input'), name);
    input.dataset.automataParameter = key; title.id = `${prefix}${name}Label`; input.setAttribute('aria-labelledby', title.id);
    if (type === 'select') for (const [value, text] of options) input.add(new Option(text, value));
    else { input.type = type; for (const [attribute, value] of Object.entries(options || {})) input.setAttribute(attribute, String(value)); }
    wrapper.append(title, input); parent.append(wrapper); inputs.set(key, input);
    input.value = String(settings[key]);
    on(input, type === 'select' ? 'change' : 'input', () => {
      const value = type === 'select' ? input.value : input.valueAsNumber;
      if (type !== 'select' && !Number.isFinite(value)) return;
      if (key === 'family') {
        rememberedRules.set(settings.family, settings.rule);
        settings.family = value;
        settings.rule = rememberedRules.get(value) ?? Math.min(settings.rule, catalogFor(value).length - 1);
        search.value = ''; atlasFamily = null;
      } else settings[key] = value;
      invalidate(); updateRule(); if (picker.open) buildAtlas();
    });
    if (type !== 'select') on(input, 'change', () => { flushPreview(); input.value = String(settings[key]); });
    return input;
  }

  field(main, 'Family', 'Family', 'family', 'select', [['elementary', 'Elementary · 256 rules'], ['totalistic-r2', 'Totalistic radius 2 · 64 rules']]);
  const navigation = el('div', 'automata-midi-rule-navigation'), previous = button('Previous', '←'), next = button('Next', '→');
  previous.setAttribute('aria-label', 'Previous automata rule'); next.setAttribute('aria-label', 'Next automata rule');
  const picker = id(el('details', 'automata-midi-rule-picker'), 'RulePicker'), pickerSummary = el('summary'), ruleLabel = id(el('span'), 'RuleLabel');
  pickerSummary.append(ruleLabel); picker.append(pickerSummary); navigation.append(previous, picker, next); main.append(navigation);
  const pickerBody = el('div', 'automata-midi-rule-picker-body'), searchLabel = el('label'), search = id(el('input'), 'RuleSearch');
  search.type = 'search'; search.placeholder = 'Rule number or binary code'; search.autocomplete = 'off';
  search.setAttribute('aria-label', 'Find automata rule by decimal or binary code'); searchLabel.append(search); pickerBody.append(searchLabel);
  const filters = el('div', 'automata-midi-rule-filters'), representativeLabel = el('label'), representatives = id(el('input'), 'Representatives');
  representatives.type = 'checkbox'; representativeLabel.append(representatives, document.createTextNode('Representatives only'));
  const ruleCount = id(el('output'), 'RuleCount'); filters.append(representativeLabel, ruleCount); pickerBody.append(filters);
  const atlas = el('div', 'automata-midi-rule-list'); atlas.setAttribute('role', 'group'); atlas.setAttribute('aria-label', 'Automata rule previews');
  const empty = el('p', 'automata-midi-caption', 'No matching rules.'); empty.hidden = true;
  pickerBody.append(atlas, empty, el('p', 'automata-midi-caption', 'Atlas: fixed random seed, periodic edges.')); picker.append(pickerBody);

  const figure = el('figure', 'automata-midi-figure'), preview = id(document.createElementNS(SVG, 'svg'), 'Preview');
  preview.setAttribute('class', 'automata-midi-preview'); preview.setAttribute('role', 'img'); preview.setAttribute('preserveAspectRatio', 'xMidYMid meet');
  const previewTitle = id(document.createElementNS(SVG, 'title'), 'PreviewTitle'), previewPath = document.createElementNS(SVG, 'path');
  preview.setAttribute('aria-labelledby', previewTitle.id); preview.append(previewTitle, previewPath);
  const readout = id(el('figcaption', 'automata-midi-caption'), 'Readout'); figure.append(preview, readout); body.append(figure);

  const parameters = id(el('details', 'automata-midi-parameters'), 'Parameters'), parameterSummary = el('summary', '', 'Pattern & MIDI settings');
  const fields = el('div', 'automata-midi-fields'); parameters.append(parameterSummary, fields); body.append(parameters);
  field(fields, 'Boundary', 'Edges', 'boundary', 'select', [['fixed', 'Fixed zero'], ['periodic', 'Wrap around']]);
  field(fields, 'Transform', 'After each step', 'transform', 'select', [['none', 'No transform'], ['shift-left', 'Shift left'], ['shift-right', 'Shift right'], ['reflect', 'Reflect'], ['complement', 'Complement']]);
  const density = field(fields, 'Density', 'Seed density · 0 = center', 'density', 'range', { min: 0, max: 1, step: .01 });
  const densityOutput = id(el('output'), 'DensityOut'); density.parentElement.insertBefore(densityOutput, density);
  field(fields, 'Seed', 'Random seed', 'seed', 'number', { min: 0, max: 4294967295, step: 1 });
  field(fields, 'Columns', 'Pitch columns', 'columns', 'number', { min: 8, max: 128, step: 1 });
  field(fields, 'Rows', 'Generations', 'rows', 'number', { min: 8, max: 128, step: 1 });
  field(fields, 'RowBeats', 'Beats per generation', 'rowBeats', 'number', { min: .125, max: 1, step: .001 });
  field(fields, 'LowestNote', 'Lowest MIDI note', 'lowestNote', 'number', { min: 0, max: 80, step: 1 });
  field(fields, 'Articulation', 'Articulation', 'articulation', 'select', [['retrigger', 'Retrigger each live cell'], ['hold', 'Hold connected cells']]);
  field(fields, 'Velocity', 'Note velocity', 'velocity', 'number', { min: 1, max: 127, step: 1 });
  const parameterActions = el('div', 'automata-midi-actions'), reroll = button('NextSeed', 'Next seed'), reset = button('Reset', 'Reset rules');
  parameterActions.append(reroll, reset); parameters.append(parameterActions);
  const actions = el('div', 'automata-midi-actions'), generate = button('Generate', actionLabel), download = id(el('a', '', 'Download MIDI'), 'Download');
  download.hidden = true; actions.append(generate, download); body.append(actions);
  const status = id(el('p', 'automata-midi-status'), 'Status'); status.setAttribute('role', 'status'); body.append(status);

  function updateRule() {
    const catalog = catalogFor(settings.family), descriptor = catalog[Math.max(0, Math.min(catalog.length - 1, Math.round(settings.rule)))];
    settings.rule = descriptor.rule;
    ruleLabel.textContent = `${settings.family === 'elementary' ? 'Rule' : 'Code'} ${descriptor.rule} · ${descriptor.bits}`;
    for (const [rule, tile] of tiles) tile.setAttribute('aria-pressed', String(rule === settings.rule));
    if (atlasFamily === settings.family) filterAtlas();
  }
  function selectRule(rule, close = false) {
    settings.rule = rule; rememberedRules.set(settings.family, rule); invalidate(); updateRule();
    if (close) { picker.open = false; pickerSummary.focus(); }
  }
  function buildAtlas() {
    if (!picker.open || atlasFamily === settings.family) return;
    atlasFamily = settings.family; tiles.clear(); const fragment = document.createDocumentFragment();
    for (const descriptor of catalogFor(settings.family)) {
      const tile = el('button', 'automata-midi-rule-tile'); tile.type = 'button'; tile.tabIndex = -1;
      tile.dataset.automataRule = String(descriptor.rule); tile.dataset.automataFamily = settings.family;
      tile.setAttribute('aria-label', `${settings.family === 'elementary' ? 'Elementary rule' : 'Totalistic code'} ${descriptor.rule}, ${descriptor.bits}`);
      tile.setAttribute('aria-pressed', String(descriptor.rule === settings.rule));
      const svg = document.createElementNS(SVG, 'svg'), path = document.createElementNS(SVG, 'path');
      svg.setAttribute('viewBox', '0 0 31 18'); svg.setAttribute('preserveAspectRatio', 'none'); svg.setAttribute('aria-hidden', 'true');
      path.setAttribute('d', automatapoeiaRowsPath(automatapoeiaPreviewRows(descriptor.rule, { family: settings.family, width: 31, height: 18 })));
      svg.append(path); tile.append(svg, el('span', '', String(descriptor.rule))); fragment.append(tile); tiles.set(descriptor.rule, tile);
    }
    atlas.replaceChildren(fragment); filterAtlas();
  }
  function filterAtlas() {
    if (atlasFamily !== settings.family) return;
    const catalog = catalogFor(settings.family), bits = settings.family === 'elementary' ? 8 : 6, query = search.value.trim().toLowerCase();
    const binary = /^(0b)?[01]+$/.test(query) && (query.startsWith('0b') || query.length === bits) ? query.replace(/^0b/, '').padStart(bits, '0') : null;
    const decimal = binary === null && /^\d+$/.test(query) ? Number(query) : null;
    let count = 0, first = null;
    for (const descriptor of catalog) {
      const tile = tiles.get(descriptor.rule);
      const match = (!representatives.checked || descriptor.representative === descriptor.rule)
        && (!query || binary === descriptor.bits || decimal === descriptor.rule);
      tile.hidden = !match; tile.tabIndex = -1;
      if (match) { count++; first ??= tile; }
    }
    const selected = tiles.get(settings.rule); (selected && !selected.hidden ? selected : first)?.setAttribute('tabindex', '0');
    ruleCount.value = `${count} / ${catalog.length}`; empty.hidden = count > 0;
  }
  function cancelPending() { ticket++; pending?.abort(); pending = null; busy = false; }
  function revokeDownload() { if (url) window.URL.revokeObjectURL(url); url = null; download.removeAttribute('href'); download.hidden = true; }
  function invalidate() {
    if (disposed) return;
    dirty = true; cancelPending(); status.textContent = ''; generate.disabled = true; revokeDownload();
    if (root.open && previewFrame === null) previewFrame = window.requestAnimationFrame(() => { previewFrame = null; flushPreview(); });
  }
  function syncFields() {
    for (const [key, input] of inputs) if (!(input.type === 'number' && document.activeElement === input)) input.value = String(settings[key]);
    inputs.get('lowestNote').max = String(128 - settings.columns);
    densityOutput.value = settings.density <= .001 ? 'Center cell' : `${Math.round(settings.density * 100)}%`;
    inputs.get('seed').disabled = settings.density <= .001; reroll.disabled = settings.density <= .001;
    updateRule();
  }
  function flushPreview() {
    if (disposed) return null;
    if (previewFrame !== null) { window.cancelAnimationFrame(previewFrame); previewFrame = null; }
    if (!dirty) return score;
    dirty = false; currentError = null; revokeDownload();
    let pixels;
    try { score = generateAutomataMidi(settings); settings = { ...score.settings }; pixels = score.pixels; }
    catch (error) { score = null; currentError = error; pixels = error.pixels ?? []; if (error.settings) settings = { ...error.settings }; }
    syncFields();
    const rows = pixels.length || settings.rows, columns = pixels[0]?.length || settings.columns;
    preview.setAttribute('viewBox', `0 0 ${columns} ${rows}`); previewPath.setAttribute('d', automatapoeiaRowsPath(pixels));
    const count = score?.notes?.length ?? 0, duration = score?.durationBeats ?? settings.rows * settings.rowBeats;
    previewTitle.textContent = `${ruleLabel.textContent}; MIDI pitches ${settings.lowestNote}–${settings.lowestNote + columns - 1}; ${rows} generations; ${count} notes; ${formatBeats(duration)} beats`;
    readout.textContent = `${columns} pitches × ${rows} generations · ${count.toLocaleString()} notes · ${formatBeats(duration)} beats`;
    generate.disabled = !score || busy;
    if (score) {
      url = window.URL.createObjectURL(new Blob([score.buffer], { type: 'audio/midi' })); download.href = url;
      download.download = `automata-${settings.family}-${settings.rule}.mid`; download.hidden = false;
    } else status.textContent = currentError?.message || 'This pattern has no notes.';
    return score;
  }

  on(root, 'toggle', () => { if (root.open) flushPreview(); });
  on(picker, 'toggle', buildAtlas);
  on(search, 'input', filterAtlas); on(representatives, 'change', filterAtlas);
  on(search, 'keydown', event => {
    if (event.key === 'Enter') { const first = [...tiles.values()].find(tile => !tile.hidden); if (first) { event.preventDefault(); selectRule(Number(first.dataset.automataRule), true); } }
  });
  on(atlas, 'click', event => { const tile = event.target.closest('[data-automata-rule]'); if (tile && atlas.contains(tile)) selectRule(Number(tile.dataset.automataRule), true); });
  on(picker, 'keydown', event => {
    if (event.key === 'Escape') { event.preventDefault(); picker.open = false; pickerSummary.focus(); return; }
    const tile = event.target.closest('[data-automata-rule]');
    if (!tile || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
    const visible = [...tiles.values()].filter(node => !node.hidden), index = visible.indexOf(tile);
    const firstTop = visible[0]?.getBoundingClientRect().top, width = visible.filter(node => Math.abs(node.getBoundingClientRect().top - firstTop) < 1).length || 1;
    const offsets = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -width, ArrowDown: width };
    const nextIndex = event.key === 'Home' ? 0 : event.key === 'End' ? visible.length - 1
      : event.key in offsets ? (index + offsets[event.key] + visible.length) % visible.length : null;
    if (nextIndex === null) return;
    event.preventDefault(); const target = visible[nextIndex]; selectRule(Number(target.dataset.automataRule)); target.focus();
  });
  for (const [control, offset] of [[previous, -1], [next, 1]]) on(control, 'click', () => {
    const count = catalogFor(settings.family).length; selectRule((settings.rule + offset + count) % count);
  });
  on(reroll, 'click', () => { settings.seed = (settings.seed + 1) >>> 0; invalidate(); });
  on(reset, 'click', () => {
    settings = { ...AUTOMATA_MIDI_DEFAULTS }; rememberedRules.clear(); rememberedRules.set(settings.family, settings.rule);
    search.value = ''; representatives.checked = false; atlasFamily = null; invalidate(); syncFields(); if (picker.open) buildAtlas();
  });
  on(generate, 'click', async () => {
    const submitted = flushPreview(); if (!submitted || disposed || busy) return;
    cancelPending(); const generation = ticket, controller = new AbortController(); pending = controller; busy = true; generate.disabled = true; status.textContent = 'Preparing MIDI…';
    try {
      const result = await onGenerate?.(submitted, { signal: controller.signal });
      if (disposed || generation !== ticket) return;
      status.textContent = typeof result === 'string' ? result : result === false ? 'MIDI selection canceled.' : 'MIDI ready.';
    } catch (error) { if (!disposed && generation === ticket && error?.name !== 'AbortError') status.textContent = error?.message || 'Could not use this MIDI pattern.'; }
    finally { if (!disposed && generation === ticket) { pending = null; busy = false; generate.disabled = !score; } }
  });
  updateRule(); generate.disabled = true;
  return {
    getScore() { return flushPreview(); },
    getSettings() { flushPreview(); return { ...settings }; },
    dispose() { if (disposed) return; disposed = true; cancelPending(); if (previewFrame !== null) window.cancelAnimationFrame(previewFrame); previewFrame = null; revokeDownload(); listeners.abort(); tiles.clear(); root.remove(); },
  };
}

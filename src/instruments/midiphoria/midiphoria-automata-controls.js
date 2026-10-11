import { AUTOMATA_MIDI_DEFAULTS, generateAutomataMidi, sanitizeAutomataMidiSettings, automataMidiSeedRow } from './midiphoria-automata-midi.js';
import { AUTOMATAPOEIA_RULES, AUTOMATAPOEIA_TOTALISTIC_RULES, AUTOMATAPOEIA_FAMILIES, AUTOMATAPOEIA_BOUNDARIES, AUTOMATAPOEIA_TRANSFORMS, automatapoeiaPreviewRows,
  automatapoeiaRowsPath } from '../cellular-automata/automatapoeia.js';

const SVG = 'http://www.w3.org/2000/svg';
const catalogFor = family => family === 'totalistic-r2' ? AUTOMATAPOEIA_TOTALISTIC_RULES : AUTOMATAPOEIA_RULES;
const formatBeats = value => Number(Number(value).toFixed(3)).toString();

/** Finite score preparation by default; optional live mode delegates transport
 * and capture to its owner. Neither mode creates audio or advances a clock. */
export function mountAutomataMidiControls(host, { idPrefix = 'automataMidi', actionLabel = 'Make MIDI', onGenerate, live: liveMode = false, onChange, onPlayPause, onRestart, onCapture } = {}) {
  const document = host.ownerDocument, window = document.defaultView ?? globalThis;
  const basePrefix = String(idPrefix).replace(/[^a-zA-Z0-9_-]/g, '-') || 'automataMidi';
  let prefix = basePrefix, suffix = 1;
  while (document.getElementById(`${prefix}Family`)) prefix = `${basePrefix}-${++suffix}`;
  const listeners = new AbortController(), inputs = new Map(), tiles = new Map();
  let settings = { ...AUTOMATA_MIDI_DEFAULTS }, score = null, currentError = null, dirty = true;
  let liveState = { playing: false, generation: 0, row: [], history: [] }, captureBusy = false, captureTicket = 0, liveRasterKey = null;
  let disposed = false, previewFrame = null, url = null, ticket = 0, pending = null, busy = false, atlasFamily = null;
  const rememberedRules = new Map([['elementary', 30], ['totalistic-r2', 20]]);
  const el = (tag, className, text) => { const node = document.createElement(tag); if (className) node.className = className; if (text != null) node.textContent = text; return node; };
  const on = (node, type, listener) => node.addEventListener(type, listener, { signal: listeners.signal });
  const id = (node, name) => { node.id = `${prefix}${name}`; return node; };
  const button = (name, text) => { const node = id(el('button', '', text), name); node.type = 'button'; return node; };
  const root = el('details', `midiphoria-automata${liveMode ? ' automata-midi-live' : ''}`), heading = el('summary', '', liveMode ? 'Automatapoeia · live' : 'Automatapoeia rules'); root.append(heading);
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
      if (key === 'seed' || key === 'density') settings.seedRow = null;
      invalidate(); updateRule(); if (picker.open) buildAtlas(); emitSettings();
    });
    if (type !== 'select') on(input, 'change', () => { flushPreview(); input.value = String(settings[key]); });
    return input;
  }

  // The original instrument's picker is authored inside its family controller,
  // not exported as a component. Keep its details/summary/thumbnail layout and
  // share the exact rule catalogue, preview raster and evolution functions.
  const picker = id(el('details', 'automata-midi-rule-picker automata-rule-picker'), 'RulePicker');
  const pickerSummary = el('summary'), pickerCopy = el('span', 'automata-rule-picker-copy');
  const ruleLabel = id(el('strong'), 'RuleLabel'); pickerCopy.append(el('span', '', 'Rules'), ruleLabel);
  const currentPreview = id(document.createElementNS(SVG, 'svg'), 'RuleCurrentPreview');
  currentPreview.setAttribute('class', 'automata-rule-current-preview'); currentPreview.setAttribute('viewBox', '0 0 31 18');
  currentPreview.setAttribute('preserveAspectRatio', 'none'); currentPreview.setAttribute('role', 'img');
  const currentTitle = id(document.createElementNS(SVG, 'title'), 'RuleCurrentPreviewTitle'), currentPath = document.createElementNS(SVG, 'path');
  currentPreview.setAttribute('aria-labelledby', currentTitle.id); currentPreview.append(currentTitle, currentPath);
  const chevron = el('span', 'automata-rule-picker-chevron', '⌄'); chevron.setAttribute('aria-hidden', 'true');
  pickerSummary.append(pickerCopy, currentPreview, chevron); picker.append(pickerSummary); main.append(picker);
  const pickerBody = el('div', 'automata-midi-rule-picker-body automata-rule-picker-panel');
  const filters = el('div', 'automata-rule-atlas-controls'), searchLabel = el('label'), search = id(el('input'), 'RuleSearch');
  const searchTitle = id(el('span', '', 'Rule or 8-bit code'), 'RuleSearchLabel');
  search.type = 'search'; search.inputMode = 'numeric'; search.autocomplete = 'off';
  search.setAttribute('aria-label', 'Find automata rule by decimal or binary code'); searchLabel.append(searchTitle, search);
  const filterLabel = el('label'), filter = id(el('select'), 'RuleFilter');
  filter.setAttribute('aria-label', 'Show automata rules');
  for (const [value, text] of [['all', 'All 256 rules'], ['representatives', '88 symmetry representatives'], ['family', 'Selected symmetry family']]) filter.add(new Option(text, value));
  filterLabel.append(el('span', '', 'Show'), filter); filters.append(searchLabel, filterLabel); pickerBody.append(filters);
  const ruleCount = id(el('output', 'automata-rule-atlas-status'), 'RuleCount'); ruleCount.setAttribute('aria-live', 'polite'); pickerBody.append(ruleCount);
  const atlas = el('div', 'automata-midi-rule-list automata-rule-atlas-grid'); atlas.setAttribute('role', 'group'); atlas.setAttribute('aria-label', 'Automata rule previews');
  const empty = el('p', 'automata-midi-caption', 'No matching rules.'); empty.hidden = true;
  pickerBody.append(atlas, empty, el('p', 'automata-midi-caption', 'Catalog thumbnails use a fixed random seed and periodic edges.')); picker.append(pickerBody);
  const navigation = el('div', 'automata-midi-rule-stepper'), previous = button('Previous', '← Previous'), next = button('Next', 'Next →');
  previous.setAttribute('aria-label', 'Previous automata rule'); next.setAttribute('aria-label', 'Next automata rule'); navigation.append(previous, next); main.append(navigation);

  const live = el('div', 'automata-midi-live-controls'); main.append(live);
  const rateLabel = el('label'), rate = id(el('input'), 'Rate'), rateOutput = id(el('output'), 'RateOut');
  rate.type = 'range'; rate.min = '1'; rate.max = '8'; rate.step = '.01'; rate.value = String(1 / settings.rowBeats);
  rate.setAttribute('aria-label', 'Generation rate in rows per beat');
  rateLabel.append(el('span', '', 'Generation rate'), rateOutput, rate); live.append(rateLabel);
  on(rate, 'input', () => { settings.rowBeats = 1 / Number(rate.value); invalidate(); emitSettings(); });
  on(rate, 'change', () => { flushPreview(); });
  const density = field(live, 'Density', 'Seed density', 'density', 'range', { min: 0, max: 1, step: .01 });
  const densityOutput = id(el('output'), 'DensityOut'); density.parentElement.insertBefore(densityOutput, density);
  field(live, 'Seed', 'Seed', 'seed', 'number', { min: 0, max: 4294967295, step: 1 });
  const seedActions = el('div', 'automata-midi-seed-actions'), restart = button('Restart', 'Restart'), reroll = button('NextSeed', 'Reseed');
  restart.setAttribute('aria-label', liveMode ? 'Restart live evolution from its chosen seed' : 'Restart the prepared pattern from its current seed');
  reroll.setAttribute('aria-label', liveMode ? 'Choose a random seed and restart live evolution' : 'Prepare a new seed without changing playing MIDI'); seedActions.append(restart, reroll); main.append(seedActions);

  const liveTransport = el('div', 'automata-midi-live-transport'), playPause = button('PlayPause', '▶');
  playPause.className = 'automata-midi-play-pause'; playPause.setAttribute('aria-label', 'Play live automata'); playPause.setAttribute('aria-pressed', 'false');
  const liveStatus = id(el('output', 'automata-midi-live-status', 'Paused · generation 0'), 'LiveStatus'); liveStatus.setAttribute('aria-live', 'off');
  liveTransport.append(el('h2', '', 'Automatapoeia'), playPause, liveStatus); liveTransport.hidden = !liveMode;
  if (liveMode) main.prepend(liveTransport);
  const seedFigure = el('figure', 'automata-midi-seed'), seedStrip = id(document.createElementNS(SVG, 'svg'), 'SeedStrip');
  seedStrip.setAttribute('role', 'img'); seedStrip.setAttribute('preserveAspectRatio', 'none'); seedStrip.setAttribute('viewBox', '0 0 48 1');
  const seedPath = document.createElementNS(SVG, 'path'); seedPath.setAttribute('fill', 'currentColor'); seedStrip.append(seedPath);
  const seedCaption = id(el('figcaption', 'automata-midi-caption'), 'SeedCaption'); seedFigure.append(seedStrip, seedCaption);
  if (liveMode) main.append(seedFigure);

  const ruleSettings = el('div', 'automata-midi-rule-settings'); main.append(el('h3', 'automata-midi-control-heading', 'Rule settings'), ruleSettings);
  field(ruleSettings, 'Family', 'Automaton family', 'family', 'select', AUTOMATAPOEIA_FAMILIES.map(({ id, label, ruleCount }) => [id, `${label} · ${ruleCount}`]));
  const rule = field(ruleSettings, 'Rule', 'Rule number', 'rule', 'range', { min: 0, max: 255, step: 1 });
  const ruleTitle = rule.previousElementSibling; ruleTitle.id = `${prefix}RuleNumberLabel`; rule.setAttribute('aria-labelledby', ruleTitle.id);
  const ruleOutput = id(el('output'), 'RuleOut'); rule.parentElement.insertBefore(ruleOutput, rule);
  field(ruleSettings, 'Boundary', 'Boundary condition', 'boundary', 'select', AUTOMATAPOEIA_BOUNDARIES.map(({ id, label }) => [id, label]));
  field(ruleSettings, 'Transform', 'Post-step transform', 'transform', 'select', AUTOMATAPOEIA_TRANSFORMS.map(({ id, label }) => [id, label]));
  const columns = field(ruleSettings, 'Columns', 'Columns / width', 'columns', 'range', { min: 8, max: 128, step: 1 });
  const columnsOutput = id(el('output'), 'ColumnsOut'); columns.parentElement.insertBefore(columnsOutput, columns);
  if (liveMode) {
    const advanced = el('details', 'automata-midi-rule-details'); advanced.append(el('summary', '', 'Rule settings'));
    ruleSettings.previousElementSibling.remove(); ruleSettings.before(advanced); advanced.append(ruleSettings);
  }

  const figure = el('figure', 'automata-midi-figure'), preview = id(document.createElementNS(SVG, 'svg'), 'Preview');
  preview.setAttribute('class', 'automata-midi-preview'); preview.setAttribute('role', 'img'); preview.setAttribute('preserveAspectRatio', 'xMidYMid meet');
  const previewTitle = id(document.createElementNS(SVG, 'title'), 'PreviewTitle'), previewPath = document.createElementNS(SVG, 'path');
  preview.setAttribute('aria-labelledby', previewTitle.id); preview.append(previewTitle, previewPath);
  const readout = id(el('figcaption', 'automata-midi-caption'), 'Readout'); figure.append(preview, readout); body.append(figure);

  const parameters = id(el('details', 'automata-midi-parameters'), 'Parameters'), parameterSummary = el('summary', '', 'MIDI pattern settings');
  const fields = el('div', 'automata-midi-fields'); parameters.append(parameterSummary, fields); body.append(parameters);
  field(fields, 'Rows', 'Generations', 'rows', 'number', { min: 8, max: 128, step: 1 }).parentElement.hidden = liveMode;
  field(fields, 'RowBeats', 'Beats per generation', 'rowBeats', 'number', { min: .125, max: 1, step: .001 });
  field(fields, 'LowestNote', 'Lowest MIDI note', 'lowestNote', 'number', { min: 0, max: 80, step: 1 });
  field(fields, 'Articulation', 'Articulation', 'articulation', 'select', [['retrigger', 'Retrigger cells'], ['hold', 'Hold notes']]);
  field(fields, 'Velocity', 'Note velocity', 'velocity', 'number', { min: 1, max: 127, step: 1 });
  const reset = button('Reset', 'Reset rules'); parameters.append(reset);
  const lookup = el('div', 'automata-midi-rule-lookup');
  const neighborhoodsLabel = el('span'), neighborhoods = id(el('code'), 'RuleNeighborhoods'), bits = id(el('output'), 'RuleBits');
  const familyLabel = el('span'), familySummary = id(el('output'), 'RuleFamilySummary');
  lookup.append(neighborhoodsLabel, neighborhoods, el('span', '', 'Next state'), bits, familyLabel, familySummary); parameters.append(lookup);
  const actions = el('div', 'automata-midi-actions'), generate = button('Generate', actionLabel), download = id(el('a', '', 'Download MIDI'), 'Download');
  download.hidden = true; actions.append(generate, download); body.append(actions);
  const status = id(el('p', 'automata-midi-status'), 'Status'); status.setAttribute('role', 'status'); body.append(status);
  const captureLength = id(el('select'), 'CaptureBeats'), capture = button('Capture', 'Capture to pad');
  captureLength.setAttribute('aria-label', 'Beats to capture from live automata');
  for (const beats of [1, 2, 4, 8, 16]) captureLength.add(new Option(`Last ${beats} ${beats === 1 ? 'beat' : 'beats'}`, String(beats)));
  captureLength.value = '4';
  if (liveMode) { root.open = true; generate.hidden = true; actions.prepend(captureLength, capture); }
  if (liveMode) { liveTransport.after(figure); figure.after(actions); }

  function settingsCopy() { return { ...settings, seedRow: settings.seedRow?.slice() ?? null }; }
  function report(error) { if (!disposed) status.textContent = error?.message || 'Could not update live automata.'; }
  function emitSettings() {
    if (!liveMode || disposed) return;
    settings = sanitizeAutomataMidiSettings(settings); syncFields(); refreshSeed();
    try { onChange?.(settingsCopy()); } catch (error) { report(error); }
  }
  function restartLive() { try { const result = onRestart?.(); result?.catch(report); } catch (error) { report(error); } }
  function refreshSeed() {
    const row = automataMidiSeedRow(settings), count = row.reduce((total, value) => total + value, 0);
    seedStrip.setAttribute('viewBox', `0 0 128 1`); seedPath.setAttribute('d', automatapoeiaRowsPath([Array.from({ length: 128 }, (_, note) => row[note - settings.lowestNote] ?? 0)]));
    seedStrip.setAttribute('aria-label', `Chosen seed: ${count} notes, MIDI pitches ${settings.lowestNote}–${settings.lowestNote + settings.columns - 1}`);
    seedCaption.textContent = `${settings.seedRow ? 'Chosen row' : 'Random / centered seed'} · ${count} notes · pitches ${settings.lowestNote}–${settings.lowestNote + settings.columns - 1}`;
  }
  function refreshLive(next = liveState) {
    if (!liveMode || disposed) return;
    liveState = next || liveState;
    const playing = Boolean(liveState.playing), generation = Math.max(0, Number(liveState.generation) || 0);
    playPause.textContent = playing ? 'Ⅱ' : '▶'; playPause.setAttribute('aria-pressed', String(playing));
    playPause.setAttribute('aria-label', playing ? 'Pause live automata' : 'Play live automata');
    liveStatus.value = `${playing ? 'Playing' : 'Paused'} · generation ${generation}`;
    const history = Array.isArray(liveState.history) ? liveState.history.slice(-64) : [];
    const rows = history.filter(item => Array.isArray(item) || Array.isArray(item?.row)).map(item => {
      const row = Array.isArray(item) ? item : item.row, base = item.lowestNote ?? settings.lowestNote;
      return Array.from({ length: 128 }, (_, note) => row[note - base] ?? 0);
    });
    if (!rows.length) {
      const row = Array.isArray(liveState.row) && liveState.row.length ? liveState.row : automataMidiSeedRow(settings);
      rows.push(Array.from({ length: 128 }, (_, note) => row[note - (liveState.rowSettings?.lowestNote ?? settings.lowestNote)] ?? 0));
    }
    const width = Math.max(1, ...rows.map(row => row.length)), rasterKey = rows.map(row => row.join('')).join('|');
    if (rasterKey !== liveRasterKey) {
      liveRasterKey = rasterKey; preview.setAttribute('viewBox', `0 0 ${width} ${rows.length}`); previewPath.setAttribute('d', automatapoeiaRowsPath(rows));
    }
    previewTitle.textContent = `Live automata history; generation ${generation}; newest row last`;
    readout.textContent = `${playing ? 'Evolving' : 'Paused'} · ${settings.columns} pitches · ${formatBeats(1 / settings.rowBeats)} rows/beat`;
    capture.disabled = captureBusy || !history.length;
  }
  function capturedDownload(result) {
    const buffer = result?.buffer ?? result?.midi;
    if (!(buffer instanceof ArrayBuffer) && !ArrayBuffer.isView(buffer)) return;
    revokeDownload(); url = window.URL.createObjectURL(new Blob([buffer], { type: 'audio/midi' }));
    download.href = url; download.download = `automata-capture-${settings.family}-${settings.rule}.mid`; download.hidden = false;
  }
  on(playPause, 'click', () => { if (disposed) return; try { const result = onPlayPause?.(); result?.catch(report); } catch (error) { report(error); } });
  on(capture, 'click', async () => {
    if (disposed || captureBusy || capture.disabled) return;
    const captureId = ++captureTicket; captureBusy = true; refreshLive();
    try {
      const result = await onCapture?.(Number(captureLength.value));
      if (disposed || captureId !== captureTicket) return;
      capturedDownload(result); status.textContent = result === false || result == null ? 'No played notes to capture yet.' : 'Captured to a stopped pad. Live evolution continues.';
    } catch (error) { report(error); }
    finally { if (!disposed && captureId === captureTicket) { captureBusy = false; refreshLive(); } }
  });

  function updateRule() {
    const catalog = catalogFor(settings.family), descriptor = catalog[Math.max(0, Math.min(catalog.length - 1, Math.round(settings.rule)))];
    settings.rule = descriptor.rule;
    const totalistic = settings.family === 'totalistic-r2';
    ruleLabel.textContent = `${totalistic ? 'Totalistic R2 · Code' : 'Elementary R1 · Rule'} ${descriptor.rule}`;
    currentTitle.textContent = `Catalog preview of ${ruleLabel.textContent}; fixed random seed and periodic edges`;
    currentPath.setAttribute('d', automatapoeiaRowsPath(automatapoeiaPreviewRows(descriptor.rule, { family: settings.family, width: 31, height: 18 })));
    rule.max = String(catalog.length - 1); rule.value = String(settings.rule); ruleOutput.value = String(settings.rule);
    pickerSummary.setAttribute('aria-label', `Rules: ${ruleLabel.textContent}`);
    ruleTitle.textContent = totalistic ? 'Totalistic code' : 'Rule number';
    searchTitle.textContent = totalistic ? 'Code or 6-bit output' : 'Rule or 8-bit code'; search.placeholder = totalistic ? '20 or 010100' : '30 or 00011110';
    filter.options[0].textContent = `All ${catalog.length} ${totalistic ? 'codes' : 'rules'}`;
    filter.options[1].textContent = `${new Set(catalog.map(item => item.representative)).size} ${totalistic ? 'color-conjugacy' : 'symmetry'} representatives`;
    filter.options[2].textContent = `Selected ${totalistic ? 'color-conjugacy' : 'symmetry'} family`;
    neighborhoodsLabel.textContent = totalistic ? 'Five-cell total' : 'Neighborhood';
    neighborhoods.textContent = totalistic ? '5  4  3  2  1  0' : '111 110 101 100 011 010 001 000';
    bits.value = descriptor.bits.split('').join(totalistic ? '  ' : '   ');
    familyLabel.textContent = totalistic ? 'Color-conjugacy family' : 'Symmetry family';
    familySummary.value = descriptor.orbit.join(' · ');
    for (const [rule, tile] of tiles) tile.setAttribute('aria-pressed', String(rule === settings.rule));
    if (atlasFamily === settings.family) filterAtlas();
  }
  function selectRule(rule, close = false) {
    settings.rule = rule; rememberedRules.set(settings.family, rule); invalidate(); updateRule(); emitSettings();
    if (close) { picker.open = false; pickerSummary.focus(); }
  }
  function buildAtlas() {
    if (!picker.open || atlasFamily === settings.family) return;
    atlasFamily = settings.family; tiles.clear(); const fragment = document.createDocumentFragment();
    for (const descriptor of catalogFor(settings.family)) {
      const tile = el('button', 'automata-midi-rule-tile automata-rule-tile'); tile.type = 'button'; tile.tabIndex = -1;
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
      const selectedOrbit = catalog[settings.rule].orbit;
      const match = (filter.value === 'representatives' ? descriptor.representative === descriptor.rule : filter.value === 'family' ? selectedOrbit.includes(descriptor.rule) : true)
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
    dirty = true; cancelPending(); status.textContent = ''; generate.disabled = true; if (!liveMode) revokeDownload();
    if (root.open && previewFrame === null) previewFrame = window.requestAnimationFrame(() => { previewFrame = null; flushPreview(); });
  }
  function syncFields() {
    for (const [key, input] of inputs) if (!(input.type === 'number' && document.activeElement === input)) input.value = String(settings[key]);
    inputs.get('lowestNote').max = String(128 - settings.columns);
    densityOutput.value = settings.density <= .001 ? 'One centered cell' : `${Math.round(settings.density * 100)}%`;
    columnsOutput.value = `${settings.columns} pitches`;
    rate.value = String(1 / settings.rowBeats); rateOutput.value = `${Number((1 / settings.rowBeats).toFixed(3))} rows/beat`;
    rate.setAttribute('aria-valuetext', rateOutput.value);
    updateRule();
  }
  function flushPreview() {
    if (disposed) return null;
    if (previewFrame !== null) { window.cancelAnimationFrame(previewFrame); previewFrame = null; }
    if (!dirty) return score;
    dirty = false; currentError = null;
    if (liveMode) { settings = sanitizeAutomataMidiSettings(settings); syncFields(); refreshSeed(); refreshLive(); return null; }
    revokeDownload();
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
  on(search, 'input', filterAtlas); on(filter, 'change', filterAtlas);
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
  on(restart, 'click', () => { if (liveMode) { restartLive(); return; } invalidate(); flushPreview(); if (score) status.textContent = `Prepared from seed ${settings.seed}. Playing MIDI is unchanged.`; });
  on(reroll, 'click', () => { settings.seed = (settings.seed + 1) >>> 0; settings.seedRow = null; if (liveMode && settings.density <= .001) settings.density = .5; invalidate(); flushPreview(); if (liveMode) { emitSettings(); restartLive(); return; } if (score) status.textContent = settings.density <= .001 ? 'One centered cell. Raise Seed density to hear different seeds.' : `Prepared seed ${settings.seed}. Send when ready.`; });
  on(reset, 'click', () => {
    settings = { ...AUTOMATA_MIDI_DEFAULTS }; rememberedRules.clear(); rememberedRules.set('elementary', 30); rememberedRules.set('totalistic-r2', 20);
    search.value = ''; filter.value = 'all'; atlasFamily = null; invalidate(); syncFields(); if (picker.open) buildAtlas(); emitSettings();
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
  updateRule(); generate.disabled = true; if (liveMode) flushPreview();
  return {
    getScore() { return liveMode ? generateAutomataMidi(settings) : flushPreview(); },
    getSettings() { flushPreview(); return settingsCopy(); },
    setSettings(partial) {
      if (disposed) return null;
      settings = sanitizeAutomataMidiSettings({ ...settings, ...partial });
      rememberedRules.set(settings.family, settings.rule); atlasFamily = null; invalidate(); flushPreview(); if (picker.open) buildAtlas(); emitSettings();
      return settingsCopy();
    },
    setSeedRow(absoluteRow) {
      if (disposed) return null;
      const cells = Array.from({ length: 128 }, (_, pitch) => Number(Number.isFinite(Number(absoluteRow?.[pitch])) && Number(absoluteRow[pitch]) > 0));
      const pitches = cells.flatMap((value, pitch) => value ? [pitch] : []);
      const low = Math.min(settings.lowestNote, ...pitches), high = Math.max(settings.lowestNote + settings.columns - 1, ...pitches);
      settings = sanitizeAutomataMidiSettings({ ...settings, lowestNote: low, columns: high - low + 1, seedRow: cells.slice(low, high + 1) });
      invalidate(); flushPreview(); emitSettings(); if (liveMode) restartLive();
      const message = `Seeded ${pitches.length} notes at their original MIDI pitches.`; status.textContent = message;
      return { count: pitches.length, message, settings: settingsCopy() };
    },
    refreshLive,
    dispose() { if (disposed) return; disposed = true; captureTicket++; cancelPending(); if (previewFrame !== null) window.cancelAnimationFrame(previewFrame); previewFrame = null; revokeDownload(); listeners.abort(); tiles.clear(); root.remove(); },
  };
}

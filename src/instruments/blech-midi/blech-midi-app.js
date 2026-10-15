import { mountSoundFontChooser } from '../../sound-fonts/chooser.js';
import { createSoundFontService } from '../../sound-fonts/bank-service.js';
import { mountMidiNoteEffectEditor } from '../../midi-note-effects-controls.js';
import { MidiMixerEngine } from '../midi-mixer/midi-mixer-engine.js';
import { mountMixerPerformance } from '../midi-mixer/midi-mixer-performance.js';
import { mountMixerKnobs } from '../midi-mixer/midi-mixer-knobs.js';
import { mountMidiSynthEffectEditor } from '../midi-mixer/midi-mixer-midi-editor.js';
import { mountMidiDrawing, DRAWING_COLUMNS, DRAWING_ROWS } from '../midiphoria/midiphoria-drawing.js';
import { GM_PROGRAM_NAMES, parseMidi, MAX_MIDI_MIXER_TEMPO } from '../midi-mixer/midi-mixer-model.js';
import { mountMidiArtCreator } from './blech-midi-art-controls.js';
import { mountBlechFilePlayer } from './blech-midi-file-player.js';
import { mountBlechText } from './blech-midi-text-controls.js';
import { mountBlechMath } from './blech-midi-math-controls.js';
import { mountBlechFrames } from './blech-midi-frames-controls.js';
import { mountBlechDropStage } from './blech-midi-drop-stage.js';
import { createBlechSpigotEngine } from './blech-midi-spigot-engine.js';
import { mountBlechSpigots } from './blech-midi-spigots.js';
import { mountBlechStampPicker } from './blech-midi-stamp-picker.js';
import { generateAutomataMidi } from '../midiphoria/midiphoria-automata-midi.js';

const $ = id => document.getElementById(id);
let retainedDraft = null;

function mountBlechMidi() {
  const events = new AbortController();
  const on = (node, type, listener) => node.addEventListener(type, listener, { signal: events.signal });
  $('mixerFontStatus').textContent = ''; $('creativeStatus').textContent = '';
  $('blechLiveLayers').replaceChildren();
  let disposed = false, frame = null, lastReflect = -Infinity, downloadUrl = null, starting = false, audioIntent = false;
  let engine, performanceView, drawing, knobs, synthEffectEditor, noteEffectEditor, artCreator, filePlayer, mathTools, frameTools, textTools;
  let masterPause = null;
  let selectedSpigot = null;
  let dropStage, stampPicker, spigots, spigotView, frameMode = 'stamps', automataSignature = '';
  const prepared = new Map();
  let bankChooser, effectsSignature = '';
  let sharedBank = null, bankQueue = Promise.resolve();
  let seedPicking = false, automataSeen = false;
  let keyboardNoteCount = 0;
  const layerNodes = new Map();
  const activeKey = () => $('blechMidi').dataset.tab === 'frames' ? frameMode : $('blechMidi').dataset.tab;
  const groupFor = key => ['stamps', 'drawing', 'art', 'scripts', 'sequence'].includes(key) ? 'frames' : key;
  function preparedChanged(key, detail) {
    prepared.set(key, detail);
    if (key === activeKey()) { showPrepared(key); if (key === 'text' && detail.settings?.loop !== undefined) dropStage?.configure({ loop: detail.settings.loop }); }
  }
  function showPrepared(key) {
    const detail = prepared.get(key) ?? {};
    dropStage?.prepare(detail.score, { ...detail.settings, source: groupFor(key), error: detail.error,
      name: detail.settings?.name || ({ files: 'Choose a MIDI file', drawing: 'Your drawing', stamps: 'Choose a stamp', art: 'Your image', scripts: 'Processed frame', sequence: 'Frame sequence', text: 'Your text', math: 'Math pattern', automata: 'Automata' }[key]) });
  }
  function prepareDrawing() {
    try { preparedChanged('drawing', { score: drawing?.model.count ? performanceView?.getDrawingScore({ applyGate: true }) : null, settings: { name: 'Your drawing' } }); }
    catch (error) { preparedChanged('drawing', { score: null, error: error.message }); }
  }
  function sendPrepared(key, score, options = {}) {
    preparedChanged(key, { score, settings: options }); showPrepared(key);
    if (options.loop !== undefined) dropStage.configure({ loop: options.loop });
    return dropStage.send();
  }
  function configureLayer(id, patch) { const source = spigots?.bySample(id); return source ? spigots.configure(source.id, patch) : engine.configureSample(id, patch); }
  function reflectLayers(state) {
    const sourceLayers = spigots?.getLayers() ?? [];
    const closed = sourceLayers.filter(source => !source.active && source.lastSample).map(source => ({ ...source.lastSample, ...source.settings, id: source.sampleId, analysis: source.score.analysis, name: source.name, paused: true, closed: true, pending: false, pendingReplacement: null }));
    state = { ...state, samples: [...state.samples, ...closed] };
    spigotView?.refresh();
    const ids = new Set(state.samples.map(sample => sample.id));
    for (const [id, node] of layerNodes) if (!ids.has(id)) {
      const focused = node.contains(document.activeElement);
      node.remove(); layerNodes.delete(id);
      if (focused) (layerNodes.values().next().value?.querySelector('[data-layer-pause]') ?? $('creativeStop')).focus({ preventScroll: true });
    }
    for (const sample of state.samples) {
      let node = layerNodes.get(sample.id);
      if (!node) {
        node = document.createElement('div'); node.className = 'blech-live-layer'; node.dataset.sampleId = sample.id;
        node.innerHTML = `<div class="blech-layer-copy"><span data-layer-name></span><small data-layer-status class="sr-only"></small><div class="blech-layer-timeline"><canvas width="256" height="12" aria-label="Note activity across this layer"></canvas><i></i></div></div>
          <button type="button" data-layer-pause></button>
          <button type="button" data-layer-mute aria-pressed="false">M</button>
          <button type="button" data-layer-solo aria-pressed="false">S</button>
          <label class="blech-layer-loop" title="Loop this layer; turn off to finish this pass"><input type="checkbox" data-layer-loop><span aria-hidden="true">↻</span></label>
          <label class="blech-layer-dial"><span>Vol</span><input type="range" min="0" max="1" step=".01" data-layer-gain><output class="sr-only" data-layer-gain-out></output></label>
          <label class="blech-layer-channel"><span>Ch</span><select data-layer-channel><option value="">Orig</option>${Array.from({ length: 16 }, (_, i) => `<option value="${i}">${i + 1}${i === 9 ? ' D' : ''}</option>`).join('')}</select></label>
          <label class="blech-layer-dial"><span>Pan</span><input type="range" min="-1" max="1" step=".01" value="0" data-layer-pan><output class="sr-only" data-layer-pan-out></output></label>
          <button type="button" data-layer-stop title="Remove this layer">×</button>`;
        node.setAttribute('role', 'group');
        const control = key => node.querySelector(`[data-layer-${key}]`);
        control('loop').addEventListener('change', event => { const source = spigots?.bySample(sample.id); if (source) spigots.loop(source.id, event.target.checked); else engine.configureSample(sample.id, { loop: event.target.checked }); });
        control('pause').addEventListener('click', () => {
          masterPause?.samples.delete(sample.id);
          const current = engine.state.samples.find(item => item.id === sample.id);
          const source = spigots?.bySample(sample.id);
          if (source) spigots.togglePlay(source.id); else if (current) engine.setSamplePaused(sample.id, !current.paused);
        });
        for (const [key, field] of [['mute', 'muted'], ['solo', 'solo']]) control(key).addEventListener('click', () => {
          const current = engine.state.samples.find(item => item.id === sample.id);
          const source = spigots?.bySample(sample.id);
          if (current || source) configureLayer(sample.id, { [field]: !(current ?? source.settings)[field] });
        });
        control('stop').addEventListener('click', () => { const source = spigots?.bySample(sample.id); if (source) spigots.remove(source.id); else engine.stopSample(sample.id); });
        for (const key of ['gain', 'pan']) control(key).addEventListener('input', event => configureLayer(sample.id, { [key]: Number(event.target.value) }));
        control('channel').addEventListener('change', event => configureLayer(sample.id, { channel: event.target.value === '' ? null : Number(event.target.value) }));
        layerNodes.set(sample.id, node); $('blechLiveLayers').append(node);
      }
      const name = `${sample.name || 'Pattern'} · ${sample.id}`;
      field(node.querySelector('[data-layer-name]'), name); node.querySelector('[data-layer-name]').title = name;
      node.setAttribute('aria-label', name);
      node.querySelector('[data-layer-loop]').setAttribute('aria-label', `Loop ${name}`);
      node.querySelector('[data-layer-stop]').setAttribute('aria-label', `Remove ${name}`);
      if (!node.querySelector('[data-layer-edit]') && performanceView?.getTextLayer(sample.id)) {
        const edit = document.createElement('button'); edit.type = 'button'; edit.dataset.layerEdit = ''; edit.textContent = 'Edit';
        edit.addEventListener('click', () => loadTextLayer(performanceView.getTextLayer(sample.id)));
        node.querySelector('.blech-layer-copy').append(edit);
      }
      node.querySelector('[data-layer-edit]')?.setAttribute('aria-label', `Edit ${name}`);
      node.querySelector('[data-layer-loop]').checked = sample.loop;
      const level = node.querySelector('[data-layer-gain]');
      value(level, sample.gain ?? .75);
      field(node.querySelector('[data-layer-gain-out]'), `${Math.round((sample.gain ?? .75) * 100)}%`);
      const pan = node.querySelector('[data-layer-pan]');
      value(pan, sample.pan ?? 0); pan.setAttribute('aria-label', `Pan ${name}`);
      field(node.querySelector('[data-layer-pan-out]'), sample.pan ? `${Math.round(Math.abs(sample.pan) * 100)}% ${sample.pan < 0 ? 'left' : 'right'}` : 'Center');
      const channelSelect = node.querySelector('[data-layer-channel]');
      value(channelSelect, sample.channel == null ? '' : sample.channel); channelSelect.setAttribute('aria-label', `MIDI channel ${name}`);
      for (const [key, stateKey, title] of [['mute', 'muted', 'Mute'], ['solo', 'solo', 'Solo']]) {
        const button = node.querySelector(`[data-layer-${key}]`);
        button.setAttribute('aria-pressed', String(Boolean(sample[stateKey])));
        button.setAttribute('aria-label', `${title} ${name}`); button.title = key === 'solo' ? 'Solo among dropped layers; keep their timing running' : 'Mute this layer; keep its timing running';
      }
      node.dataset.muted = String(Boolean(sample.effectiveMuted));
      level.setAttribute('aria-label', `Volume ${name}`);
      const timeline = node.querySelector('.blech-layer-timeline');
      timeline.querySelector('i').style.left = `${100 * Math.min(1, (sample.positionBeats ?? 0) / Math.max(.001, sample.durationBeats ?? sample.analysis.durationBeats))}%`;
      if (node._score !== sample.analysis) {
        node._score = sample.analysis;
        const map = timeline.querySelector('canvas'), context = map.getContext('2d'), bins = new Uint32Array(128), duration = Math.max(.001, sample.analysis.durationBeats);
        for (const note of sample.analysis.notes) bins[Math.min(127, Math.floor(note.beat / duration * 128))]++;
        const max = Math.max(1, ...bins); context.clearRect(0, 0, 256, 12); context.fillStyle = '#96f4cc';
        bins.forEach((count, x) => { const height = count ? Math.max(1, Math.sqrt(count / max) * 12) : 0; context.fillRect(x * 2, 12 - height, 2, height); });
      }
      node.dataset.paused = String(Boolean(sample.paused));
      const pause = node.querySelector('[data-layer-pause]'), action = sample.closed ? 'Play' : sample.paused ? 'Resume' : 'Pause';
      field(pause, sample.paused ? '▶' : 'Ⅱ'); pause.setAttribute('aria-label', `${action} ${node.getAttribute('aria-label')}`);
      pause.setAttribute('aria-pressed', String(Boolean(sample.paused)));
      pause.title = sample.paused ? 'Resume this layer from its paused position' : 'Pause only this layer';
      const stateLabel = sample.closed ? 'Valve closed' : sample.pendingReplacement ? 'Update next loop' : sample.paused ? 'Paused' : sample.pending ? `In ${Number(sample.pendingBeats.toFixed(2))} beats` : sample.loop ? 'Looping' : 'One shot';
      const channel = sample.channel == null ? 'Original channels' : `Ch ${sample.channel + 1}`;
      const program = Number.isInteger(sample.midi?.program) && sample.midi.program >= 0 ? GM_PROGRAM_NAMES[sample.midi.program] : 'Original instruments';
      field(node.querySelector('[data-layer-status]'), `${stateLabel} · ${channel} · ${program}`);
      node.querySelector('[data-layer-name]').title = `${name} · ${stateLabel} · ${channel} · ${program}`;
    }
    $('blechLayersEmpty').hidden = Boolean(state.samples.length);
    const toggle = $('blechAutomataToggle');
    automataSeen ||= Boolean(state.automata?.playing);
    toggle.hidden = !automataSeen;
    field(toggle, state.automata?.playing ? 'Pause evolution' : 'Resume evolution');
    toggle.setAttribute('aria-pressed', String(Boolean(state.automata?.playing)));
  }
  const field = (node, value) => { if (node.textContent !== value) node.textContent = value; };
  const value = (node, next) => {
    if (document.activeElement !== node && node.value !== String(next)) { node.value = String(next); knobs?.update(node); }
  };
  function revokeDownload() {
    if (downloadUrl) URL.revokeObjectURL(downloadUrl);
    downloadUrl = null; $('downloadDrawingMidi').hidden = true; $('downloadDrawingMidi').removeAttribute('href');
  }
  function reflect() {
    if (disposed || !engine) return;
    const state = engine.state, enabled = state.audioEnabled;
    $('blechGeneratedNotes').value = Math.round((state.generatedNoteCount ?? 0) + keyboardNoteCount).toLocaleString();
    $('audioButton').setAttribute('aria-pressed', String(enabled));
    $('audioButton').classList.toggle('is-loading', starting);
    field($('audioState'), starting ? 'starting' : enabled ? 'on' : state.error ? 'retry' : 'off');
    $('previewDrawingMidi').disabled = !drawing?.model.count;
    $('captureDrawingFrame').disabled = !drawing?.model.count;
    const paused = state.samples.filter(sample => sample.paused).length, playing = state.samples.length - paused;
    const masterPlaying = Boolean(playing || state.automata?.playing || filePlayer?.getTransportState().playing);
    $('blechMasterPlay').setAttribute('aria-pressed', String(masterPlaying));
    $('blechMasterPlay').setAttribute('aria-label', masterPlaying ? 'Pause all playback' : 'Play or resume playback');
    $('blechMasterPlay').title = masterPlaying ? 'Pause running sources together' : masterPause ? 'Resume sources paused together' : 'Play prepared source or resume paused layers';
    field($('creativePlaybackStatus'), `${playing} playing${paused ? ` · ${paused} paused` : ''}${state.automata?.playing ? ' + evolution' : ''}${enabled ? '' : ' · audio off'}`);
    $('blechMidi').dataset.audio = String(enabled);
    $('blechMidi').dataset.samples = String(state.samples.length);
    field($('mixerFontName'), state.soundfontName || 'TimGM6mb');
    const signature = JSON.stringify(state.effects);
    if (signature !== effectsSignature) {
      effectsSignature = signature;
      const effects = state.effects, menu = $('mixerEchoTime');
      let custom = menu.querySelector('[data-custom-time]');
      if (![.125, .25, .5, .75, 1, 1.5, 2, 4].includes(effects.delayBeats)) {
        if (!custom) { custom = new Option(); custom.dataset.customTime = ''; menu.append(custom); }
        custom.value = String(effects.delayBeats); custom.textContent = `${effects.delayBeats.toFixed(3)} beats`;
      } else custom?.remove();
      value($('mixerFilter'), Math.log10(effects.filterHz)); value($('mixerFilterExact'), Math.round(effects.filterHz));
      value($('mixerEcho'), effects.delayMix); value(menu, effects.delayBeats); value($('mixerEchoExact'), effects.delayBeats); value($('mixerFeedback'), effects.feedback);
      $('mixerFilterOut').value = effects.filterHz >= 19000 ? 'Open' : `${Math.round(effects.filterHz)} Hz`;
      $('mixerEchoOut').value = `${Math.round(effects.delayMix * 100)}%`; $('mixerFeedbackOut').value = `${Math.round(effects.feedback * 100)}%`;
      synthEffectEditor?.refresh();
    }
    noteEffectEditor?.refresh();
    performanceView?.refresh(state);
    reflectLayers(state);
    textTools?.refresh();
    const nextAutomata = JSON.stringify(state.automata.settings);
    if (automataSignature !== nextAutomata) {
      automataSignature = nextAutomata;
      try { preparedChanged('automata', { score: generateAutomataMidi(state.automata.settings), settings: { name: `Automata · rule ${state.automata.settings.rule}`, program: String(state.automata.settings.program ?? 0) } }); }
      catch (error) { preparedChanged('automata', { score: null, error: error.message }); }
    }
    if (state.error) field($('creativeStatus'), state.error);
  }
  drawing = mountMidiDrawing({ canvas: $('drawingCanvas'), status: $('drawingStatus'),
    undoButton: $('drawingUndo'), clearButton: $('drawingClear'), eraseButton: $('drawingErase'),
    onChange: model => { performanceView?.cancelEdit(); $('generateDrawingMidi').disabled = !model.count; refreshSeedBridge(model); revokeDownload(); prepareDrawing(); reflect(); },
    onSeedRow: row => { $('drawingSeedRow').value = String(row + 1); refreshSeedBridge(drawing?.model); } });
  if (retainedDraft) {
    drawing.model.pixels = retainedDraft.map(row => [...row]);
    $('generateDrawingMidi').disabled = !drawing.model.count; $('drawingClear').disabled = !drawing.model.count;
    $('drawingStatus').value = `${drawing.model.count} pixels`; $('drawingCanvas').dataset.pixels = String(drawing.model.count);
    drawing.render(); retainedDraft = null;
  }
  engine = new MidiMixerEngine({ onState: reflect, maxTempo: MAX_MIDI_MIXER_TEMPO });
  engine.setVolume(Number($('outputLevel').value));
  engine.setTempo(Number($('creativeTempo').value));
  performanceView = mountMixerPerformance($('creativeControlsHost'), { engine,
    getDrawing: () => drawing.model.count ? drawing.model.score() : null,
    showVisualizer: false, orientation: 'falling', volumeHost: $('creativeVolumeHost'), automataHost: $('automataMidiTools'), padsHost: $('creativePadsHost'),
    onPrepare: (score, settings) => preparedChanged('stamps', { score, settings, error: settings?.error }),
    liveAutomata: true, shapeHost: $('drawingShapeControls'), messageHost: false, onEditDrawing: loadDrawingCopy, onEditText: loadTextLayer });
  const sound = $('automataSound'); sound.replaceChildren();
  GM_PROGRAM_NAMES.forEach((name, program) => sound.add(new Option(`${program + 1}. ${name}`, String(program))));
  sound.value = '0';
  engine.configureAutomata({ program: 0, gain: Number($('automataVolume').value) });
  on(sound, 'change', () => engine.configureAutomata({ program: Number(sound.value) }));
  on($('automataVolume'), 'input', () => { engine.configureAutomata({ gain: Number($('automataVolume').value) }); $('automataVolumeOut').value = `${Math.round(Number($('automataVolume').value) * 100)}%`; });
  // Keep source sound beside that source while its controls remain independently owned.
  $('automataMidiTools').append($('automataMidiTools').querySelector('.blech-automata-sound'));
  const noteEffectHost = document.createElement('div'); $('creativeControlsHost').append(noteEffectHost);
  noteEffectEditor = mountMidiNoteEffectEditor(noteEffectHost, { id: 'blechNoteFx',
    getValue: () => engine.state.noteEffects, onChange: value => { engine.setNoteEffects(value); filePlayer?.setNoteEffects(value); } });
  $('creativeControlsHost').append($('mixerEffects'));
  synthEffectEditor = mountMidiSynthEffectEditor($('mixerSynthEffects'), {
    label: 'SoundFont effects', getValue: () => engine.state.effects.synth,
    onChange: synth => engine.configureEffects({ synth }),
  });
  $('drawingPlaybackOptions').append($('creativeControlsHost').querySelector('.mixer-stamp-switches'));
  $('mixerSampleLevel').closest('label').querySelector('b').textContent = 'Layer volume';
  $('mixerSampleLevel').setAttribute('aria-label', 'Generated layer volume');
  $('mixerSampleLevel').closest('label').title = 'Volume of stamps, drawings, text, math and frame layers. Automatapoeia has its own volume.';
  filePlayer = mountBlechFilePlayer($('blackMidiPlayer'), { engine, creditsHost: $('blackMidiCredits'), libraryHost: $('midiFilesTools'), settingsHost: $('midiVisualizerTools'), transportHost: $('blechFileTransport'), onPrepare: detail => preparedChanged('files', detail),
    onNoteCount: ({ passed, total }) => { $('blechFileNotes').value = passed == null ? '—' : passed.toLocaleString(); $('blechFileTotal').value = total == null ? '—' : total.toLocaleString(); },
    onKeyboardNote: () => { keyboardNoteCount++; reflect(); },
  });
  spigots = createBlechSpigotEngine({ engine, sendScore: (score, options) => performanceView.sendScore(score, options), onChange: () => reflect() });
  dropStage = mountBlechDropStage($('blechDropControls'), $('blackMidiViewport'), {
    getTempo: () => engine.state.tempo,
    getView: () => ({ alignment: document.querySelector('[data-alignment]')?.value, lookAhead: Number(document.querySelector('[data-look]')?.value ?? 6), keyboardPosition: Number(document.querySelector('[data-present]')?.value ?? 60) / 100 }),
    onDrop: (score, options) => {
      const sent = spigots.create(dropStage.getSourceScore() ?? score, options);
      if (sent && activeKey() === 'drawing') { revokeDownload(); downloadUrl = URL.createObjectURL(new Blob([sent.buffer], { type: 'audio/midi' })); $('downloadDrawingMidi').href = downloadUrl; $('downloadDrawingMidi').hidden = false; }
      reflect(); return sent;
    },
    onSettings: settings => { knobs?.update($('blechDropGain')); if (settings.source === 'text' && $('blechTextLoop')) $('blechTextLoop').checked = settings.loop; },
    onStop: source => { for (const sample of engine.state.samples) if (sample.source === source) { masterPause?.samples.delete(sample.id); spigots?.forgetSample(sample.id); engine.stopSample(sample.id); } if (source === 'automata') { if (masterPause) masterPause.automata = false; engine.setAutomataPlaying(false); } if (source === 'files') { if (masterPause) masterPause.file = null; filePlayer.stop(); } reflect(); },
  });
  spigotView = mountBlechSpigots($('blackMidiViewport'), {
    controlsHost: $('blechSpigotControls'),
    getLayers: () => spigots.getLayers(),
    getPreparedScore: () => ({ score: dropStage.getSourceScore(), settings: dropStage.getSettings() }),
    getTempo: () => engine.state.tempo,
    getView: () => ({ alignment: document.querySelector('[data-alignment]')?.value, lookAhead: Number(document.querySelector('[data-look]')?.value ?? 6), keyboardPosition: Number(document.querySelector('[data-present]')?.value ?? 60) / 100 }),
    onCreate: (score, settings) => spigots.create(score, settings),
    onEdit: (id, settings) => spigots.edit(id, settings),
    onToggleLoop: (id, enabled) => spigots.loop(id, enabled),
    onTogglePlay: id => { const source = spigots.getLayers().find(layer => layer.id === id); if (source) masterPause?.samples.delete(source.sampleId); spigots.togglePlay(id); },
    onRemove: id => spigots.remove(id),
    onBrushStart: options => spigots.brushStart(options),
    onBrushMove: (id, point) => spigots.brushMove(id, point),
    onBrushEnd: id => spigots.brushEnd(id),
    onModeChange: mode => dropStage.suspendInteractions(Boolean(selectedSpigot) || mode !== 'select'),
    onSelectionChange: id => { selectedSpigot = id; dropStage.suspendInteractions(Boolean(id) || spigotView?.getMode() !== 'select'); },
  });
  on($('midiVisualizerTools'), 'input', () => { dropStage.refresh(); spigotView.refresh(); });
  stampPicker = mountBlechStampPicker($('blechStampPicker'), { entries: performanceView.getStamps(), selectedId: 'heart', onSelect: id => { void performanceView.prepareStamp(id).then(() => { if (!disposed) stampPicker.update(performanceView.getStamps()); }).catch(error => field($('creativeStatus'), error.message)); } });
  $('blechSavedDrops').append($('mixerSavedPads'));
  $('creativePadsHost').querySelector('.mixer-stamp-palette').hidden = true;
  $('mixerStampAgain').textContent = 'Refresh preview';
  $('creativeControlsHost').querySelector('.mixer-stamp-midi > summary').textContent = 'Layer MIDI controls';
  const frameAdvanced = document.createElement('details'); frameAdvanced.className = 'blech-frame-advanced';
  const frameSummary = document.createElement('summary'); frameSummary.textContent = 'More frame controls';
  frameAdvanced.append(frameSummary, $('creativeControlsHost').querySelector('.mixer-stamp-source-controls')); $('blechPanel-frames').append(frameAdvanced);
  for (const type of ['input', 'change']) on(frameAdvanced, type, () => { if (frameMode === 'drawing') prepareDrawing(); else if (frameMode === 'stamps') void performanceView.prepareStamp(stampPicker.value); });
  const seedActions = $('automataMidiTools').querySelector('.automata-midi-seed-actions');
  $('automataMidiTools').querySelector('.automata-midi-live-transport').after(seedActions);
  $('automataMidiTools').querySelector('.automata-midi-live-transport h2').textContent = 'Live evolution';
  for (const type of ['input', 'change']) on($('drawingShapeControls'), type, () => { if (frameMode === 'drawing') prepareDrawing(); else if (frameMode === 'stamps') void performanceView.prepareStamp(stampPicker.value); });
  knobs = mountMixerKnobs($('blechMidi'));
  artCreator = mountMidiArtCreator($('midiArtCreator'), {
    getDrawingScore: () => { const score = performanceView.getDrawingScore(); return { ...score, analysis: score.analysis ?? parseMidi(score.buffer) }; },
    getTempo: () => engine.state.tempo,
    getSourceScore: source => source === 'stamp' ? performanceView.getPreparedScore() : performanceView.getDrawingScore(),
    onPrepare: detail => { preparedChanged('art', detail); preparedChanged('scripts', detail); },
    onSend: (score, options) => sendPrepared(frameMode === 'scripts' ? 'scripts' : 'art', score, options),
    onPreview: score => filePlayer.previewScore(score),
  });
  const onDrop = source => (score, options) => sendPrepared(source, score, options);
  mathTools = mountBlechMath($('midiMathTools'), { getTempo: () => engine.state.tempo, onDrop: onDrop('math'), onPrepare: detail => preparedChanged('math', detail) });
  frameTools = mountBlechFrames($('midiFramesTools'), { getDrawingScore: () => performanceView.getDrawingScore(), getTempo: () => engine.state.tempo, onDrop: onDrop('sequence'), onPrepare: detail => preparedChanged('sequence', detail), onEditDrawing: loadDrawingCopy });
  on($('captureDrawingFrame'), 'click', () => { try { const index = frameTools.capture(); field($('creativeStatus'), `Frame ${index + 1} captured. Open Frames to arrange and drop the sequence.`); } catch (error) { field($('creativeStatus'), error.message); } });
  textTools = mountBlechText($('drawingMessageHost'), { getTempo: () => engine.state.tempo,
    getProgram: () => $('mixerSampleProgram').value,
    onDrop: onDrop('text'), onPrepare: detail => preparedChanged('text', detail),
    onApply: (id, score, options) => { const result = performanceView.replaceScore(id, score, options); if (result) spigots.adoptText(id, score); return result; },
    getLayer: id => engine.state.samples.find(sample => sample.id === id) });
  function loadTextLayer(detail) {
    if (!detail) return;
    activateTab('text'); textTools.edit(detail);
  }
  const tabs = [...document.querySelectorAll('[data-blech-tab]')];
  const frameTabs = [...document.querySelectorAll('[data-frame-tab]')];
  function activateFrame(name, focus = false) {
    frameMode = name;
    for (const tab of frameTabs) { const active = tab.dataset.frameTab === name; tab.setAttribute('aria-selected', String(active)); tab.tabIndex = active ? 0 : -1; }
    for (const id of ['stamps', 'drawing', 'art', 'sequence']) $('blechPanel-' + id).hidden = id !== (name === 'scripts' ? 'art' : name);
    $('blechPanel-art').setAttribute('aria-labelledby', 'blechTab-' + (name === 'scripts' ? 'scripts' : 'art'));
    $('blechMidi').dataset.frame = name;
    $('drawingShapeControls').hidden = !['stamps', 'drawing'].includes(name);
    artCreator?.setMode(name === 'scripts' ? 'scripts' : 'images');
    if (name === 'drawing') { drawing.render(); prepareDrawing(); }
    if (name === 'stamps' && !prepared.has('stamps')) void performanceView.prepareStamp(stampPicker.value);
    if (focus) frameTabs.find(tab => tab.dataset.frameTab === name)?.focus({ preventScroll: true });
    showPrepared(name);
  }
  function activateTab(name, focus = false) {
    if (['stamps', 'drawing', 'art', 'scripts', 'sequence'].includes(name)) { activateTab('frames'); activateFrame(name, focus); return; }
    const selected = tabs.find(tab => tab.dataset.blechTab === name) ?? tabs[0]; name = selected.dataset.blechTab;
    for (const tab of tabs) {
      const active = tab === selected;
      tab.setAttribute('aria-selected', String(active)); tab.tabIndex = active ? 0 : -1;
      $(tab.getAttribute('aria-controls')).hidden = !active;
    }
    // Both tab groups retain a keyboard entry point while one panel is active.
    for (const group of document.querySelectorAll('.blech-preparation > [role="tablist"]')) if (!group.querySelector('[tabindex="0"]')) group.querySelector('[role="tab"]').tabIndex = 0;
    $('blechMidi').dataset.tab = name;
    $('blechDropControls').hidden = ['sound', 'visuals'].includes(name);
    if (name === 'frames') activateFrame(frameMode);
    else if (['sound', 'visuals'].includes(name)) dropStage.hide();
    else showPrepared(name);
    if (focus) selected.focus({ preventScroll: true });
  }
  function wireTabs(list, attribute, activate) {
    list.forEach(tab => {
      on(tab, 'click', () => activate(tab.dataset[attribute]));
      on(tab, 'keydown', event => {
        const siblings = list.filter(other => other.parentElement === tab.parentElement), index = siblings.indexOf(tab);
        const next = { ArrowRight: (index + 1) % siblings.length, ArrowLeft: (index + siblings.length - 1) % siblings.length, Home: 0, End: siblings.length - 1 }[event.key];
        if (next !== undefined) { event.preventDefault(); activate(siblings[next].dataset[attribute], true); }
      });
    });
  }
  wireTabs(tabs, 'blechTab', activateTab); wireTabs(frameTabs, 'frameTab', activateFrame);
  activateTab('math');
  const hashTab = () => {
    const name = { '#automata': 'automata', '#automataMidiTools': 'automata', '#drawingEditor': 'drawing', '#midiArtCreator': 'art', '#blackMidiPlayer': 'files', '#black-midi': 'files' }[location.hash];
    if (name) activateTab(name);
  };
  on(globalThis, 'hashchange', hashTab); hashTab();
  on($('blechAutomataToggle'), 'click', () => { if (masterPause) masterPause.automata = false; engine.setAutomataPlaying(!engine.state.automata.playing); reflect(); });
  function refreshSeedBridge(model = drawing?.model) {
    const row = Number($('drawingSeedRow').value) - 1;
    $('drawingSeedRowOut').value = String(row + 1);
    const count = model?.pixels[row]?.reduce((sum, value) => sum + Number(Boolean(value)), 0) ?? 0;
    $('drawingUseSeed').disabled = !count;
    $('drawingSeedStatus').value = count ? `${count} painted cells in the seed row` : 'Choose a row with painted cells';
  }
  function loadDrawingCopy(score, name) {
    const analysis = score.analysis ?? parseMidi(score.buffer);
    const pitches = analysis.notes.map(note => note.note);
    if (!pitches.length) return;
    const low = Math.min(...pitches), high = Math.max(...pitches), span = Math.max(12, high - low + 1), base = Math.max(0, Math.min(low, 128 - span));
    const duration = Math.max(.25, analysis.durationBeats);
    const pixels = Array.from({ length: DRAWING_ROWS }, () => Array(DRAWING_COLUMNS).fill(0));
    for (const note of analysis.notes) {
      const x = Math.min(DRAWING_COLUMNS - 1, Math.floor((note.note - base + .5) * DRAWING_COLUMNS / span));
      const start = Math.max(0, Math.floor(note.beat / duration * DRAWING_ROWS)), end = Math.min(DRAWING_ROWS, Math.ceil((note.beat + note.duration) / duration * DRAWING_ROWS));
      for (let y = start; y < Math.max(start + 1, end) && y < DRAWING_ROWS; y++) pixels[DRAWING_ROWS - 1 - y][x] = 1;
    }
    for (const [id, value] of [['mixerStampSpan', span], ['mixerStampDrawBase', base], ['mixerStampOffset', 0], ['mixerStampBeats', Math.min(64, duration)]]) {
      $(id).value = String(value); $(id).dispatchEvent(new Event('input', { bubbles: true }));
    }
    drawing.loadPixels(pixels);
    field($('creativeStatus'), `${name} copied into the 48 × 32 drawing grid. Drop creates a new pad.`);
    activateTab('drawing');
  }
  on($('drawingSeedMode'), 'click', () => {
    seedPicking = !seedPicking; $('drawingSeedMode').setAttribute('aria-pressed', String(seedPicking));
    drawing.setSeedSelection(Number($('drawingSeedRow').value) - 1, seedPicking);
  });
  on($('drawingSeedRow'), 'input', () => { drawing.setSeedSelection(Number($('drawingSeedRow').value) - 1, seedPicking); refreshSeedBridge(); });
  on($('drawingUseSeed'), 'click', () => {
    try {
      const score = performanceView.getDrawingScore(), row = score.pixels[Number($('drawingSeedRow').value) - 1];
      const pitches = Array(128).fill(0);
      row.forEach((cell, column) => { if (cell) pitches[score.lowestNote + column] = 1; });
      const result = performanceView.setAutomataSeed(pitches);
      $('drawingSeedStatus').value = result.message;
    } catch (error) { field($('creativeStatus'), error.message); }
  });
  drawing.setSeedSelection(Number($('drawingSeedRow').value) - 1, false); refreshSeedBridge();
  function sendDrawing() {
    if (disposed || !drawing.model.count) return;
    try {
      const score = sendPrepared('drawing', performanceView.getDrawingScore({ applyGate: true }));
      if (!score?.buffer) return;
      revokeDownload(); downloadUrl = URL.createObjectURL(new Blob([score.buffer], { type: 'audio/midi' }));
      $('downloadDrawingMidi').href = downloadUrl; $('downloadDrawingMidi').hidden = false;
      field($('creativeStatus'), ''); reflect();
    } catch (error) { field($('creativeStatus'), error.message || 'Could not send this drawing.'); }
  }
  on($('generateDrawingMidi'), 'click', sendDrawing);
  on($('previewDrawingMidi'), 'click', async () => {
    try { await filePlayer.previewScore(performanceView.getDrawingScore(), 'Your drawing'); }
    catch (error) { field($('creativeStatus'), error.message); }
  });
  // A master pause owns only sources it actually paused. Other controls retain
  // their independent intent, and identity checks prevent old files or edited
  // replacement layers from being revived by a later master resume.
  function toggleMasterPlayback() {
    if (disposed) return;
    const state = engine.state, file = filePlayer.getTransportState();
    const running = state.samples.filter(sample => !sample.paused);
    if (running.length || state.automata.playing || file.playing) {
      const snapshot = masterPause ?? { samples: new Map(), file: null, automata: false };
      for (const sample of running) {
        const paused = engine.setSamplePaused(sample.id, true);
        if (paused) snapshot.samples.set(sample.id, { scoreVersion: paused.scoreVersion, playbackEpoch: paused.playbackEpoch });
      }
      if (file.playing) snapshot.file = filePlayer.pause();
      if (state.automata.playing) { engine.setAutomataPlaying(false); snapshot.automata = true; }
      masterPause = snapshot;
    } else if (masterPause) {
      const snapshot = masterPause; masterPause = null;
      for (const sample of state.samples) {
        const previous = snapshot.samples.get(sample.id);
        if (sample.paused && previous && previous.scoreVersion === sample.scoreVersion && previous.playbackEpoch === sample.playbackEpoch) engine.setSamplePaused(sample.id, false);
      }
      if (snapshot.file) filePlayer.play(snapshot.file);
      if (snapshot.automata) engine.setAutomataPlaying(true);
    } else {
      const paused = state.samples.filter(sample => sample.paused);
      if (paused.length) for (const sample of paused) engine.setSamplePaused(sample.id, false);
      else if (activeKey() === 'files') filePlayer.play();
      else dropStage.send();
    }
    reflect();
  }
  on($('blechMasterPlay'), 'click', toggleMasterPlayback);
  for (const id of ['automataMidiPlayPause', 'automataMidiRestart']) on($(id), 'click', () => { if (masterPause) masterPause.automata = false; });
  on($('creativeStop'), 'click', () => { masterPause = null; spigotView?.cancelGesture(); spigots?.stopAll(); performanceView.stopSamples(); engine.setAutomataPlaying(false); filePlayer.stop(); filePlayer.releaseKeyboard(); reflect(); });
  on($('blechResetNoteCount'), 'click', () => { engine.resetNoteCount(); keyboardNoteCount = 0; reflect(); });
  for (const button of document.querySelectorAll('[data-drawing-stamp]')) on(button, 'click', () => drawing.stamp(button.dataset.drawingStamp));
  on($('creativeTempo'), 'input', () => {
    const tempo = engine.setTempo(Number($('creativeTempo').value));
    $('creativeTempoOut').value = `${Number(tempo.toFixed(1))} BPM`;
    if (document.activeElement !== $('creativeTempoExact')) $('creativeTempoExact').value = String(Number(tempo.toFixed(1)));
    textTools.refreshTempo(); frameTools.refreshTempo();
    filePlayer.setTempo(); dropStage.refresh();
  });
  on($('creativeTempoExact'), 'input', event => {
    if (!event.target.validity.valid || event.target.value === '') return;
    $('creativeTempo').value = event.target.value;
    $('creativeTempo').dispatchEvent(new Event('input', { bubbles: true }));
  });
  on($('creativeTempoExact'), 'change', () => { $('creativeTempoExact').value = String(Number(engine.state.tempo.toFixed(1))); });
  on($('outputLevel'), 'input', () => { engine.setVolume(Number($('outputLevel').value)); $('outputLevelOut').value = `${Math.round(engine.state.volume * 100)}%`; });
  for (const [id, key, convert] of [['mixerFilter', 'filterHz', number => 10 ** number], ['mixerEcho', 'delayMix', Number], ['mixerEchoTime', 'delayBeats', Number], ['mixerFeedback', 'feedback', Number]]) {
    on($(id), id === 'mixerEchoTime' ? 'change' : 'input', event => engine.configureEffects({ [key]: convert(Number(event.target.value)) }));
  }
  for (const [id, key] of [['mixerFilterExact', 'filterHz'], ['mixerEchoExact', 'delayBeats']]) {
    on($(id), 'change', event => { if (event.target.validity.valid) engine.configureEffects({ [key]: Number(event.target.value) }); });
  }
  on($('mixerEffectsReset'), 'click', () => engine.configureEffects({ filterHz: 20000, delayMix: 0, delayBeats: .5, feedback: .3, synth: null }));
  function loadSharedBank({ bytes, name }) {
    // Both consumers commit or both return to the last accepted bank. Serialize
    // chooser requests so an older rollback cannot undo a newer selection.
    const pending = bankQueue.catch(() => {}).then(async () => {
      if (disposed) throw new DOMException('SoundFont selection cancelled.', 'AbortError');
      if (!sharedBank) {
        const response = await fetch(new URL('../../../assets/midiphoria/soundfont/TimGM6mb.sf2', import.meta.url), { signal: events.signal });
        if (!response.ok) throw new Error('Could not prepare SoundFont recovery. Try again.');
        sharedBank = { bytes: await response.arrayBuffer(), name: 'TimGM6mb' };
      }
      const previous = sharedBank;
      try {
        await filePlayer.loadSoundFont(bytes, name);
        if (disposed) throw new DOMException('SoundFont selection cancelled.', 'AbortError');
        await engine.loadSoundFont(bytes, name);
        sharedBank = { bytes, name };
      } catch (error) {
        if (disposed) throw error;
        const restored = await Promise.allSettled([filePlayer.loadSoundFont(previous.bytes, previous.name), engine.loadSoundFont(previous.bytes, previous.name)]);
        if (restored.some(result => result.status === 'rejected')) {
          audioIntent = false; engine.setAudioEnabled(false); filePlayer.setAudioEnabled(false); reflect();
          throw new Error('SoundFont recovery failed. Audio is off; choose a bank again.');
        }
        reflect(); throw error;
      }
      if (!disposed) reflect();
    });
    bankQueue = pending.catch(() => {}); return pending;
  }
  const fontService = createSoundFontService();
  bankChooser = mountSoundFontChooser($('mixerBankChooser'), {
    service: { ...fontService, list: async () => (await fontService.list()).map(entry => ({ ...entry,
      group: entry.bundleId ? (entry.generalMidi || entry.bundleId === 'timgm6mb' ? 'General MIDI · 128 instruments' : 'Specialist banks') : entry.group,
    })) },
    fileInput: $('mixerSoundFont'), defaultButton: $('mixerDefaultFont'),
    onLoad: loadSharedBank,
    onStatus(state) { if (!disposed) field($('mixerFontStatus'), state.error?.message || (state.loading ? 'Loading SoundFont…' : state.current ? `Using ${state.current.name}` : '')); },
  });
  on($('blechShowBanks'), 'click', () => { $('blechTab-files').click(); $('mixerBankChooser').scrollIntoView({ block: 'nearest' }); $('mixerBankChooser').querySelector('summary')?.focus({ preventScroll: true }); });
  on($('audioButton'), 'click', async () => {
    audioIntent = !(starting ? audioIntent : engine.state.audioEnabled);
    if (!audioIntent) { spigotView?.cancelGesture(); spigots?.stopAll(); masterPause = null; starting = false; performanceView.cancelPending(); engine.setAudioEnabled(false); filePlayer.setAudioEnabled(false); reflect(); return; }
    starting = true; field($('creativeStatus'), '');
    // Creating and resuming the native context stays inside this explicit gesture.
    const pending = engine.enableAudio(); reflect();
    try { if (await pending && !disposed && audioIntent) await filePlayer.enableAudio(); }
    finally { if (!disposed) { starting = false; if (!audioIntent) { engine.setAudioEnabled(false); filePlayer.setAudioEnabled(false); } reflect(); } }
  });
  function tick(now) {
    frame = null; if (disposed || document.hidden) return;
    if (now - lastReflect > 100) { lastReflect = now; reflect(); }
    frame = requestAnimationFrame(tick);
  }
  on(document, 'visibilitychange', () => {
    performanceView.setActive(!document.hidden);
    if (document.hidden) { if (frame !== null) cancelAnimationFrame(frame); frame = null; }
    else { drawing.render(); if (frame === null) frame = requestAnimationFrame(tick); }
  });
  on(globalThis, 'pagehide', () => {
    if (disposed) return;
    retainedDraft = drawing.model.pixels.map(row => [...row]);
    disposed = true; audioIntent = false; masterPause = null; bankChooser?.dispose(); revokeDownload(); events.abort();
    if (frame !== null) cancelAnimationFrame(frame);
    $('drawingPlaybackOptions').querySelector('.mixer-stamp-switches')?.remove();
    spigotView?.dispose(); spigots?.dispose(); dropStage.dispose(); stampPicker.dispose(); frameAdvanced.remove(); prepared.clear(); textTools.dispose(); mathTools.dispose(); frameTools.dispose(); artCreator.dispose(); filePlayer.dispose(); performanceView.dispose(); noteEffectEditor.destroy(); drawing.destroy(); synthEffectEditor.destroy(); knobs.destroy(); void engine.dispose();
  });
  performanceView.setView('draw'); performanceView.setActive(!document.hidden); reflect();
  if (!document.hidden) frame = requestAnimationFrame(tick);
  void fetch(new URL('../../../assets/midiphoria/collection.json', import.meta.url), { signal: events.signal })
    .then(response => { if (!response.ok) throw new Error('File stamps could not load. Drawings and generated patterns are ready.'); return response.json(); })
    .then(collection => { if (!disposed) { performanceView.setCollection(collection); filePlayer.setCollection(collection); stampPicker.update(performanceView.getStamps()); } })
    .catch(error => { if (!disposed && error.name !== 'AbortError') field($('creativeStatus'), error.message); });
}

mountBlechMidi();
globalThis.addEventListener('pageshow', event => { if (event.persisted) mountBlechMidi(); });

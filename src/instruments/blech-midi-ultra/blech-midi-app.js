import { mountSoundFontChooser } from '../../sound-fonts/chooser.js';
import { createSoundFontService } from '../../sound-fonts/bank-service.js';
import { mountMidiNoteEffectEditor } from '../../midi-note-effects-controls.js';
import { MidiMixerEngine } from '../midi-mixer/midi-mixer-engine.js';
import { mountMixerPerformance } from '../midi-mixer/midi-mixer-performance.js';
import { mountMixerKnobs } from '../midi-mixer/midi-mixer-knobs.js';
import { mountMidiSynthEffectEditor } from '../midi-mixer/midi-mixer-midi-editor.js';
import { mountMidiDrawing, DRAWING_COLUMNS, DRAWING_ROWS } from '../midiphoria/midiphoria-drawing.js';
import { GM_PROGRAM_NAMES, parseMidi, MAX_MIDI_MIXER_TEMPO, MIDI_SAMPLE_LIMITS } from '../midi-mixer/midi-mixer-model.js';
import { mountMidiArtCreator } from './blech-midi-art-controls.js';
import { mountBlechFilePlayer } from './blech-midi-file-player.js';
import { mountBlechFreeText, mountBlechText } from './blech-midi-text-controls.js';
import { mountBlechMath } from './blech-midi-math-controls.js';
import { mountBlechFrames } from './blech-midi-frames-controls.js';
import { mountBlechDropStage, dropScoreDimensions, resizeDropScore } from './blech-midi-drop-stage.js';
import { createBlechSpigotEngine, isBlechLiveSource, blechStrokeScore, blechRailNoteScore, blechGeometryDrawing, blechBrushImprint, brushPitches, createBlechLoopCatch } from './blech-midi-spigot-engine.js';
import { mountBlechSpigots } from './blech-midi-spigots.js';
import { mountBlechStampPicker } from './blech-midi-stamp-picker.js';
import { generateAutomataMidi } from '../midiphoria/midiphoria-automata-midi.js';

const $ = id => document.getElementById(id);
// The physical dial stops at 1000 BPM; 60–300 occupies 71% of its turn.
const BLECH_TEMPO_CURVE = [[0, 0], [60, .14], [300, .85], [1000, 1]];
let retainedDraft = null;

function mountBlechMidi() {
  const events = new AbortController();
  const on = (node, type, listener) => node.addEventListener(type, listener, { signal: events.signal });
  // Keep the shared Tap bound to the native dial, but put it after the exact
  // field in both the visual and keyboard order. The shared controller still
  // owns its button (including cleanup) when it lives outside its wrapper.
  let masterTapObserver = null;
  const placeMasterTap = () => {
    const button = document.querySelector('.blech-midi-transport [data-tap-control="#creativeTempo"]');
    if (!button) return false;
    const exact = $('creativeTempoExact').closest('label');
    if (button.previousElementSibling !== exact) exact.after(button);
    return true;
  };
  if (!placeMasterTap()) {
    masterTapObserver = new MutationObserver(() => {
      if (placeMasterTap()) { masterTapObserver.disconnect(); masterTapObserver = null; }
    });
    masterTapObserver.observe(document.querySelector('.blech-midi-transport'), { childList: true, subtree: true });
  }
  $('mixerFontStatus').textContent = ''; $('creativeStatus').textContent = '';
  $('blechLiveLayers').replaceChildren();
  let disposed = false, frame = null, lastReflect = -Infinity, downloadUrl = null, starting = false, audioIntent = false;
  let engine, performanceView, drawing, knobs, synthEffectEditor, noteEffectEditor, artCreator, filePlayer, mathTools, frameTools, textTools;
  let masterPause = null, zeroTempo = false, zeroPausedPlayback = false;
  let brushSize = 1, brushNib = 'square', brushVelocity = 88, brushRepeatBeats = 0, brushMenuOwner = null;
  const getBrush = () => ({ size: brushSize, height: brushSize, nib: brushNib, velocity: brushVelocity });
  const getView = () => {
    const controls = $('blackMidiControls');
    return { alignment: controls?.querySelector('[data-alignment]')?.value,
      lookAhead: Number(controls?.querySelector('[data-look]')?.value ?? 6),
      keyboardPosition: Number(controls?.querySelector('[data-present]')?.value ?? 78) / 100 };
  };
  const liveStampSize = { widthNotes: null, heightBeats: null };
  const loopStampSize = { scale: 1 };
  const drawingGestures = { draw: 'pencil', workbox: 'pencil' };
  let geometryFill = 'outline', mathMode = 'workbox';
  let liveDrawing = null;
  let selectedSpigot = null, canvasStampId = 'heart', canvasStampPrepared = null;
  let dropStage, stampPicker, workboxStampPicker, workboxStamp = null, spigots, spigotView, freeText, frameMode = 'drawing', automataSignature = '';
  const prepared = new Map();
  let bankChooser, effectsSignature = '';
  let sharedBank = null, bankQueue = Promise.resolve();
  let seedPicking = false, automataSeen = false;
  const loopCatch = createBlechLoopCatch();
  let keyboardNoteCount = 0;
  const layerNodes = new Map();
  const reflectLayersButtons = () => {
    const expanded = $('blechLayers').dataset.expanded === 'true';
    const button = $('blechLayersToggle');
    button.setAttribute('aria-expanded', String(expanded));
    button.setAttribute('aria-label', `${expanded ? 'Close' : 'Open'} layers · ${layerNodes.size}`);
  };
  const activeKey = () => $('blechMidi').dataset.tab === 'frames' ? frameMode : $('blechMidi').dataset.tab;
  const groupFor = key => ['stamps', 'drawing', 'art', 'scripts', 'sequence'].includes(key) ? 'frames' : key;
  function preparedChanged(key, detail) {
    prepared.set(key, detail);
    if (key === activeKey() && !freeText?.active && !(key === 'math' && mathMode === 'free')) {
      showPrepared(key);
      if (key === 'text' && detail.settings?.loop !== undefined) dropStage?.configure({ loop: detail.settings.loop });
    }
  }
  function showPrepared(key) {
    const detail = prepared.get(key) ?? {};
    dropStage?.prepare(detail.score, { ...detail.settings, source: groupFor(key), draftKey: key, error: detail.error,
      name: detail.settings?.name || ({ files: 'Choose a MIDI file', drawing: 'Your drawing', stamps: 'Choose a stamp', art: 'Your image', scripts: 'Processed frame', sequence: 'Frame sequence', text: 'Your text', math: 'Math pattern', automata: 'Automata', catch: 'Caught phrase' }[key]) });
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
  let layerEditorSource = null, layerEditorReturn = null;
  const layerEditor = document.createElement('section');
  layerEditor.id = 'blechLayerEditor'; layerEditor.className = 'blech-layer-editor'; layerEditor.hidden = true;
  layerEditor.setAttribute('role', 'group');
  layerEditor.innerHTML = `<div class="blech-layer-editor-heading"><strong data-layer-editor-name></strong><button type="button" data-layer-editor-close aria-label="Close layer settings">×</button></div>
    <label>Pitch<input data-layer-field="transpose" type="number" min="-127" max="127" step="1"></label>
    <label>Delay · beats<input data-layer-field="delayBeats" type="number" min="0" max="64" step=".25"></label>
    <label>Width · notes<input data-layer-field="widthNotes" type="number" min="1" max="128" step="1"></label>
    <label>Height · beats<input data-layer-field="heightBeats" type="number" min=".25" max="512" step=".25"></label>
    <label>Rotation · °<input data-layer-field="rotationDegrees" type="number" min="0" max="359" step="1"></label>
    <label>MIDI channel<select data-layer-channel-edit><option value="">Original channels</option>${Array.from({ length: 16 }, (_, index) => `<option value="${index}">${index + 1}${index === 9 ? ' · drums' : ''}</option>`).join('')}</select></label>
    <label>Instrument<select data-layer-program><option value="original">Original instruments</option>${GM_PROGRAM_NAMES.map((name, index) => `<option value="${index}">${index + 1} · ${name}</option>`).join('')}</select></label>
    <output data-layer-editor-status role="status"></output>`;
  function closeLayerEditor(restoreFocus = false) {
    const owner = [...layerNodes.values()].find(node => node.dataset.spigotId === layerEditorSource);
    const returnTo = layerEditorReturn?.isConnected ? layerEditorReturn : owner?.querySelector('[data-layer-settings]');
    layerEditorSource = null; layerEditor.hidden = true;
    layerEditorReturn = null;
    for (const node of layerNodes.values()) node.querySelector('[data-layer-settings]')?.setAttribute('aria-expanded', 'false');
    $('blackMidiViewport').querySelector('[data-spigot-settings]')?.setAttribute('aria-expanded', 'false');
    if (restoreFocus) returnTo?.focus({ preventScroll: true });
  }
  function openLayerEditor(source, trigger) {
    if (layerEditorSource === source.id && !layerEditor.hidden) { closeLayerEditor(true); return; }
    // On a phone the tool drawer and local editor cannot both fit; Layers
    // stays open independently, and the editor uses the stage's free lane.
    if (matchMedia('(max-width: 700px), (max-height: 500px)').matches) setPanelOpen(false);
    layerEditorSource = source.id;
    layerEditorReturn = trigger;
    layerEditor.querySelector('[data-layer-editor-status]').value = '';
    reflectLayerEditor(); layerEditor.querySelector('input').focus({ preventScroll: true });
  }
  function reflectLayerEditor() {
    const source = spigots?.getLayers().find(layer => layer.id === layerEditorSource);
    const owner = source && layerNodes.get(source.sampleId);
    if (!source || !owner) { closeLayerEditor(layerEditor.contains(document.activeElement)); return; }
    layerEditor.hidden = false; layerEditor.dataset.spigotId = source.id;
    layerEditor.setAttribute('aria-label', `Layer settings for ${source.name}`);
    layerEditor.querySelector('[data-layer-editor-name]').textContent = source.name;
    for (const node of layerNodes.values()) node.querySelector('[data-layer-settings]')?.setAttribute('aria-expanded', String(node === owner));
    $('blackMidiViewport').querySelector('[data-spigot-settings]')?.setAttribute('aria-expanded', 'true');
    const labels = { transpose: 'Pitch offset in semitones', delayBeats: 'Delay in beats', widthNotes: 'Width in notes', heightBeats: 'Height in beats', rotationDegrees: 'Rotation in degrees' };
    for (const input of layerEditor.querySelectorAll('[data-layer-field]')) {
      const key = input.dataset.layerField;
      const fallback = key === 'widthNotes' ? source.score.pitchWidth ?? 128 : key === 'heightBeats' ? source.score.analysis.durationBeats : 0;
      if (document.activeElement !== input) input.value = String(source.settings[key] ?? fallback);
      input.setAttribute('aria-label', `${labels[key]} for ${source.name}`);
    }
    const program = layerEditor.querySelector('[data-layer-program]');
    const selected = Object.hasOwn(source.settings.midi ?? {}, 'program') ? source.settings.midi.program : source.settings.program;
    if (document.activeElement !== program) program.value = selected == null || selected === 'original' ? 'original' : String(selected);
    program.setAttribute('aria-label', `Instrument for ${source.name}`);
    const channel = layerEditor.querySelector('[data-layer-channel-edit]');
    if (document.activeElement !== channel) channel.value = source.settings.channel == null ? '' : String(source.settings.channel);
    channel.setAttribute('aria-label', `MIDI channel for ${source.name}`);
    const viewport = $('blackMidiViewport')?.getBoundingClientRect(), anchor = $('blackMidiViewport')?.querySelector('.blech-spigot-move')?.getBoundingClientRect();
    if (viewport && anchor?.width) {
      const width = layerEditor.offsetWidth, height = layerEditor.offsetHeight;
      const near = anchor.right - viewport.left + width + 16 < viewport.width ? anchor.right - viewport.left + 8
        : anchor.left - viewport.left - width - 8 >= 0 ? anchor.left - viewport.left - width - 8 : anchor.left - viewport.left;
      const drawer = $('blechLayers').hidden
        ? $('blechMidi').dataset.panelOpen === 'true' ? document.querySelector('.blech-workbench')?.getBoundingClientRect() : null
        : $('blechLayers').getBoundingClientRect();
      const roomBeforeDrawer = drawer?.left - viewport.left - width - 8;
      // With a side drawer open, keep the popup in the graphic's free lane.
      // Otherwise it can intercept e.g. Type's Apply button even when that
      // button is visibly inside its own drawer.
      const rightEdge = roomBeforeDrawer >= 8 && drawer.top < viewport.bottom && drawer.bottom > viewport.top
        ? Math.min(viewport.width - width - 8, roomBeforeDrawer) : viewport.width - width - 8;
      const maxLeft = Math.max(8, rightEdge), maxTop = Math.max(8, viewport.height - height - 8);
      const clampPopup = (value, high) => Math.max(8, Math.min(high, value));
      const initialLeft = clampPopup(near, maxLeft), initialTop = clampPopup(anchor.top - viewport.top, maxTop);
      let left = initialLeft, top = initialTop;
      const stage = $('blackMidiViewport'), protectedControls = [
        [stage.querySelector('.blech-spigot-valves'), 1e6],
        [stage.querySelector('.blech-spigot-rotate'), 1e5],
        [stage.querySelector('.blech-spigot-move'), 1e4],
        ...[...stage.querySelectorAll('.blech-spigot-grip:not([hidden])')].map(node => [node, 1e4]),
      ].filter(([node]) => node && getComputedStyle(node).visibility === 'visible').map(([node, priority]) => {
        const bounds = node.getBoundingClientRect();
        return { left: bounds.left - viewport.left - 4, right: bounds.right - viewport.left + 4,
          top: bounds.top - viewport.top - 4, bottom: bounds.bottom - viewport.top + 4, priority };
      });
      const obstruction = (x, y) => protectedControls.reduce((total, target) => {
        const area = Math.max(0, Math.min(x + width, target.right) - Math.max(x, target.left))
          * Math.max(0, Math.min(y + height, target.bottom) - Math.max(y, target.top));
        return total + (area ? target.priority + area : 0);
      }, 0);
      if (obstruction(left, top)) {
        // Keep the popup local without hiding the little transport or frame
        // handles. If a short screen cannot fit both, minimize the overlap.
        let best = Infinity;
        for (const x of [initialLeft, anchor.left - viewport.left - width - 8, maxLeft, 8])
          for (const y of [initialTop, 8, maxTop, ...protectedControls.flatMap(target => [target.top - height - 8, target.bottom + 8])]) {
            const candidateLeft = clampPopup(x, maxLeft), candidateTop = clampPopup(y, maxTop);
            const rank = obstruction(candidateLeft, candidateTop) + Math.abs(candidateLeft - initialLeft) + Math.abs(candidateTop - initialTop);
            if (rank < best) { best = rank; left = candidateLeft; top = candidateTop; }
          }
      }
      layerEditor.style.left = `${left}px`;
      layerEditor.style.top = `${top}px`;
    }
  }
  on(layerEditor.querySelector('[data-layer-editor-close]'), 'click', () => closeLayerEditor(true));
  on(layerEditor, 'keydown', event => { if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); closeLayerEditor(true); } });
  on(layerEditor, 'focusout', () => queueMicrotask(() => { if (layerEditorSource && !disposed) reflectLayerEditor(); }));
  on(document, 'pointerdown', event => { if (layerEditorSource && !layerEditor.contains(event.target) && !event.target.closest('[data-layer-settings], [data-spigot-settings]')) closeLayerEditor(); });
  on(layerEditor, 'change', event => {
    const source = spigots?.getLayers().find(layer => layer.id === layerEditorSource);
    if (!source) return;
    const target = event.target, status = layerEditor.querySelector('[data-layer-editor-status]');
    try {
      if (target.matches('[data-layer-field]')) {
        if (!target.value || !target.validity.valid) { status.value = 'Use a value within the shown range.'; return; }
        spigots.edit(source.id, { [target.dataset.layerField]: Number(target.value) });
      } else if (target.matches('[data-layer-channel-edit]')) {
        spigots.configure(source.id, { channel: target.value === '' ? null : Number(target.value) });
      } else if (target.matches('[data-layer-program]')) {
        const program = target.value === 'original' ? null : Number(target.value);
        const midi = engine.state.samples.find(sample => sample.id === source.sampleId)?.midi ?? source.settings.midi ?? {};
        spigots.configure(source.id, { program: program ?? 'original', midi: { ...midi, program } });
      }
      status.value = ''; reflectLayerEditor();
    } catch (error) { status.value = error.message || 'Could not update this layer.'; }
  });
  function configureLayer(id, patch) { const source = spigots?.bySample(id); return source ? spigots.configure(source.id, patch) : engine.configureSample(id, patch); }
  function reflectLayerSelection() {
    for (const node of layerNodes.values()) {
      const selected = Boolean(selectedSpigot && node.dataset.spigotId === selectedSpigot);
      node.dataset.selected = String(selected);
      node.querySelector('[data-layer-name]').setAttribute('aria-pressed', String(selected));
    }
  }
  function selectLayer(id, sampleId) {
    let source = spigots?.getLayers().find(layer => layer.id === id);
    if (!source && sampleId != null) {
      const text = performanceView?.getTextLayer(sampleId);
      source = spigots?.adoptSample(sampleId, text ? { textSettings: text.settings } : undefined);
    }
    if (!source) return;
    freeText?.deactivate();
    // The tool drawer floats over the stage on phones and short screens.
    // Explicitly choosing a layer makes its frame and grips the active task.
    if (matchMedia('(max-width: 700px), (max-height: 500px)').matches) setPanelOpen(false);
    spigotView?.setMode('select'); spigotView?.select(source.id);
    return source;
  }
  function reflectLayers(state) {
    const sourceLayers = spigots?.getLayers() ?? [];
    const closed = sourceLayers.filter(source => !source.active && source.lastSample).map(source => ({ ...source.lastSample, ...source.settings, id: source.sampleId, analysis: source.score.analysis, name: source.name, paused: true, closed: true, pending: false, pendingReplacement: null }));
    // The rack is for saved/transformable layers, not for the audio clock's
    // transient Free Draw strokes or the playable rails.
    state = { ...state, samples: [...state.samples.filter(sample => !isBlechLiveSource(sample.source)), ...closed] };
    spigotView?.refresh();
    const ids = new Set(state.samples.map(sample => sample.id));
    for (const [id, node] of layerNodes) if (!ids.has(id)) {
      const focused = node.contains(document.activeElement);
      node.remove(); layerNodes.delete(id);
      if (focused) (layerNodes.values().next().value?.querySelector('[data-layer-pause]') ?? $('blechMasterPlay')).focus({ preventScroll: true });
    }
    for (const sample of state.samples) {
      let node = layerNodes.get(sample.id);
      if (!node) {
        node = document.createElement('div'); node.className = 'blech-live-layer'; node.dataset.sampleId = sample.id;
        node.dataset.advanced = 'false';
        node.innerHTML = `<button type="button" data-layer-name data-layer-select aria-pressed="false">
            <span class="blech-layer-number" aria-hidden="true"></span>
            <span class="blech-layer-timeline" aria-hidden="true"><canvas width="256" height="24"></canvas><i></i></span>
            <svg class="blech-layer-loop-mark" viewBox="0 0 24 24" aria-hidden="true"><path d="M19 8a8 8 0 1 0 1 7m0-7V3m0 5h-5"/></svg>
            <small data-layer-status class="sr-only"></small>
          </button>
          <button type="button" data-layer-pause><svg viewBox="0 0 24 24" aria-hidden="true"><path class="blech-layer-play-icon" d="m8 5 11 7-11 7Z"/><path class="blech-layer-pause-icon" d="M8 5v14M16 5v14"/></svg></button>
          <button type="button" data-layer-mix aria-expanded="false" aria-controls="blechLayerMix${sample.id}" title="More layer controls"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 6h16M4 12h16M4 18h16"/><circle cx="9" cy="6" r="2"/><circle cx="16" cy="12" r="2"/><circle cx="8" cy="18" r="2"/></svg></button>
          <button type="button" data-layer-stop title="Delete only this layer"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M9 7V4h6v3m-9 0 1 14h10l1-14M10 11v6m4-6v6"/></svg></button>
          <div class="blech-layer-advanced" id="blechLayerMix${sample.id}" role="group" hidden>
            <button type="button" data-layer-mute aria-pressed="false" title="Mute this layer"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 9h4l5-4v14l-5-4H4zM17 8l5 8m0-8-5 8"/></svg></button>
            <button type="button" data-layer-solo aria-pressed="false" title="Solo this layer"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 14V9a8 8 0 0 1 16 0v5M4 14v5h4v-6H4zm12-1h4v6h-4z"/></svg></button>
            <label class="blech-layer-loop" title="Loop this layer; turn off to finish this pass"><input type="checkbox" data-layer-loop><span aria-hidden="true">↻</span></label>
            <label class="blech-layer-dial" title="Layer volume"><span class="sr-only">Volume</span><input type="range" min="0" max="1" step=".01" data-layer-gain><output class="sr-only" data-layer-gain-out></output></label>
            <label class="blech-layer-channel" title="MIDI channel"><span class="sr-only">MIDI channel</span><select data-layer-channel><option value="">Orig</option>${Array.from({ length: 16 }, (_, i) => `<option value="${i}">${i + 1}${i === 9 ? ' D' : ''}</option>`).join('')}</select></label>
            <label class="blech-layer-dial" title="Stereo pan"><span class="sr-only">Pan</span><input type="range" min="-1" max="1" step=".01" value="0" data-layer-pan><output class="sr-only" data-layer-pan-out></output></label>
            <button type="button" data-layer-settings title="Layer settings" aria-expanded="false" aria-controls="blechLayerEditor"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M10 2h4l.5 2.5 1.7.7 2.1-1.2 2.8 2.8-1.2 2.1.7 1.7L23 10v4l-2.4.5-.7 1.7 1.2 2.1-2.8 2.8-2.1-1.2-1.7.7L14 22h-4l-.5-2.4-1.7-.7-2.1 1.2-2.8-2.8 1.2-2.1-.7-1.7L1 14v-4l2.4-.5.7-1.7-1.2-2.1 2.8-2.8 2.1 1.2 1.7-.7z"/><circle cx="12" cy="12" r="3"/></svg></button>
          </div>`;
        node.setAttribute('role', 'listitem');
        const control = key => node.querySelector(`[data-layer-${key}]`);
        control('name').addEventListener('click', () => selectLayer(node.dataset.spigotId, sample.id));
        control('settings').addEventListener('click', () => {
          const source = selectLayer(node.dataset.spigotId, sample.id); if (!source) return;
          openLayerEditor(source, control('settings'));
        });
        control('mix').addEventListener('click', () => {
          const open = node.dataset.advanced !== 'true';
          for (const other of layerNodes.values()) {
            other.dataset.advanced = 'false';
            other.querySelector('[data-layer-mix]').setAttribute('aria-expanded', 'false');
            other.querySelector('.blech-layer-advanced').hidden = true;
          }
          node.dataset.advanced = String(open);
          control('mix').setAttribute('aria-expanded', String(open));
          node.querySelector('.blech-layer-advanced').hidden = !open;
        });
        node.addEventListener('keydown', event => {
          if (event.key !== 'Escape' || node.dataset.advanced !== 'true') return;
          event.stopPropagation(); event.preventDefault();
          node.dataset.advanced = 'false'; control('mix').setAttribute('aria-expanded', 'false');
          node.querySelector('.blech-layer-advanced').hidden = true;
          control('mix').focus({ preventScroll: true });
        });
        node.addEventListener('click', event => {
          if (!event.target.closest('button, input, select, label, a, [role="slider"]')) selectLayer(node.dataset.spigotId, sample.id);
        });
        control('loop').addEventListener('change', event => {
          const source = spigots?.bySample(sample.id);
          if (source) spigots.loop(source.id, event.target.checked);
          else engine.configureSample(sample.id, { loop: event.target.checked });
        });
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
      const source = spigots?.bySample(sample.id);
      node.dataset.spigotId = source?.id ?? '';
      const name = `${sample.name || 'Pattern'} · ${sample.id}`;
      node.querySelector('[data-layer-name]').setAttribute('aria-label', `Select ${name}`);
      field(node.querySelector('.blech-layer-number'), source?.id?.split('-').at(-1) ?? String(sample.id));
      const ink = ['#c7ff2a', '#ff4f92', '#f2dd71', '#ff2532', '#77bdff'][((Number(source?.id?.split('-').at(-1)) || sample.id) - 1) % 5];
      if (node.style.getPropertyValue('--blech-layer-ink') !== ink) node.style.setProperty('--blech-layer-ink', ink);
      node.setAttribute('aria-label', name);
      node.querySelector('[data-layer-loop]').setAttribute('aria-label', `Loop ${name}`);
      node.querySelector('[data-layer-stop]').setAttribute('aria-label', `Remove ${name}`);
      node.querySelector('[data-layer-mix]').setAttribute('aria-label', `More controls for ${name}`);
      node.querySelector('.blech-layer-advanced').setAttribute('aria-label', `Mix ${name}`);
      node.querySelector('[data-layer-settings]').setAttribute('aria-label', `Layer settings for ${name}`);
      if (!node.querySelector('[data-layer-edit]') && performanceView?.getTextLayer(sample.id)) {
        const edit = document.createElement('button'); edit.type = 'button'; edit.dataset.layerEdit = '';
        edit.title = 'Edit text in this layer';
        edit.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m4 16 11-11 4 4L8 20H4zM13 7l4 4"/></svg>';
        edit.addEventListener('click', () => loadTextLayer(performanceView.getTextLayer(sample.id)));
        node.querySelector('.blech-layer-advanced').append(edit);
      }
      node.querySelector('[data-layer-edit]')?.setAttribute('aria-label', `Edit ${name}`);
      const loop = node.querySelector('[data-layer-loop]');
      const cornerOnlyLoop = ['comb', 'crossing'].includes(source?.source);
      loop.checked = sample.loop;
      loop.disabled = cornerOnlyLoop;
      loop.closest('.blech-layer-loop').hidden = cornerOnlyLoop;
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
      node.dataset.loop = String(Boolean(sample.loop));
      level.setAttribute('aria-label', `Volume ${name}`);
      const timeline = node.querySelector('.blech-layer-timeline');
      timeline.querySelector('i').style.left = `${100 * Math.min(1, (sample.positionBeats ?? 0) / Math.max(.001, sample.durationBeats ?? sample.analysis.durationBeats))}%`;
      if (node._score !== sample.analysis) {
        node._score = sample.analysis;
        const map = timeline.querySelector('canvas'), context = map.getContext('2d'), bins = new Uint32Array(128), duration = Math.max(.001, sample.analysis.durationBeats);
        for (const note of sample.analysis.notes) bins[Math.min(127, Math.floor(note.beat / duration * 128))]++;
        const max = Math.max(1, ...bins); context.clearRect(0, 0, 256, 24);
        context.fillStyle = node.style.getPropertyValue('--blech-layer-ink');
        bins.forEach((count, x) => { const height = count ? Math.max(2, Math.sqrt(count / max) * 23) : 0; context.fillRect(x * 2, 24 - height, 2, height); });
      }
      node.dataset.paused = String(Boolean(sample.paused));
      node.dataset.closed = String(Boolean(sample.closed));
      const pause = node.querySelector('[data-layer-pause]'), action = sample.closed ? 'Play' : sample.paused ? 'Resume' : 'Pause';
      pause.setAttribute('aria-label', `${action} ${name}`);
      pause.setAttribute('aria-pressed', String(!sample.paused && !sample.closed));
      pause.title = sample.closed ? 'Play this layer again' : sample.paused ? 'Resume this layer' : 'Pause this layer';
      const stateLabel = sample.closed ? 'Valve closed' : sample.pendingReplacement ? 'Update next loop' : sample.paused ? 'Paused' : sample.pending ? `In ${Number(sample.pendingBeats.toFixed(2))} beats` : sample.hold ? 'Held' : sample.loop ? 'Looping' : 'One shot';
      const channel = sample.channel == null ? 'Original channels' : `Ch ${sample.channel + 1}`;
      const program = Number.isInteger(sample.midi?.program) && sample.midi.program >= 0 ? GM_PROGRAM_NAMES[sample.midi.program] : 'Original instruments';
      field(node.querySelector('[data-layer-status]'), `${stateLabel} · ${channel} · ${program}`);
      node.querySelector('[data-layer-name]').title = `${name} · ${stateLabel} · ${channel} · ${program}`;
    }
    reflectLayerSelection();
    if (layerEditorSource) reflectLayerEditor();
    $('blechLayersEmpty').hidden = Boolean(state.samples.length);
    field($('blechLayersTotal'), String(state.samples.length));
    field($('blechLayerCount'), String(state.samples.length));
    $('blechLayerCount').hidden = !state.samples.length;
    reflectLayersButtons();
    const assignments = $('blechChannelAssignments');
    const channels = new Set(state.samples.map(sample => String(sample.id)));
    for (const node of assignments.querySelectorAll('[data-channel-sample-id]')) if (!channels.has(node.dataset.channelSampleId)) node.remove();
    for (const sample of state.samples) {
      let row = assignments.querySelector(`[data-channel-sample-id="${sample.id}"]`);
      if (!row) {
        row = document.createElement('label'); row.dataset.channelSampleId = sample.id;
        row.innerHTML = `<span></span><select aria-label="MIDI channel"><option value="">Original channels</option>${Array.from({ length: 16 }, (_, index) => `<option value="${index}">${index + 1}${index === 9 ? ' · drums' : ''}</option>`).join('')}</select>`;
        row.querySelector('select').addEventListener('change', event => configureLayer(sample.id, { channel: event.target.value === '' ? null : Number(event.target.value) }));
        assignments.append(row);
      }
      row.querySelector('span').textContent = sample.name || 'Layer';
      row.querySelector('select').setAttribute('aria-label', `MIDI channel for ${sample.name || 'Layer'}`);
      if (document.activeElement !== row.querySelector('select')) row.querySelector('select').value = sample.channel == null ? '' : String(sample.channel);
    }
    assignments.hidden = !state.samples.length;
    $('blechChannelsEmpty').hidden = Boolean(state.samples.length);
    const toggle = $('blechAutomataToggle');
    automataSeen ||= Boolean(state.automata?.playing);
    toggle.hidden = !automataSeen;
    toggle.setAttribute('aria-label', state.automata?.playing ? 'Pause evolution' : 'Resume evolution');
    toggle.title = toggle.getAttribute('aria-label');
    toggle.setAttribute('aria-pressed', String(Boolean(state.automata?.playing)));
  }
  const field = (node, value) => { if (node.textContent !== value) node.textContent = value; };
  const value = (node, next) => {
    if (document.activeElement !== node && node.value !== String(next)) { node.value = String(next); knobs?.update(node); }
  };
  function showNoteCount(count) {
    const output = $('blechNotesPlayed'), text = Math.round(count).toLocaleString();
    if (output.textContent === text && output.firstElementChild) return;
    output.replaceChildren(...Array.from(text, character => {
      const part = document.createElement('span');
      part.className = character === ',' ? 'blech-counter-separator' : 'blech-counter-digit';
      part.setAttribute('aria-hidden', 'true');
      part.textContent = character;
      return part;
    }));
    output.setAttribute('aria-label', `Notes played: ${text}`);
  }
  function revokeDownload() {
    if (downloadUrl) URL.revokeObjectURL(downloadUrl);
    downloadUrl = null; $('downloadDrawingMidi').hidden = true; $('downloadDrawingMidi').removeAttribute('href');
  }
  function reflect(state = engine?.state) {
    if (disposed || !engine) return;
    // An explicit gesture has already painted this UI; do not repaint it
    // again on the very next periodic frame.
    lastReflect = performance.now();
    const enabled = state.audioEnabled;
    showNoteCount((filePlayer?.getPlayedNoteCount() ?? 0) + (state.generatedNoteCount ?? 0) + keyboardNoteCount);
    $('audioButton').setAttribute('aria-pressed', String(enabled));
    $('audioButton').classList.toggle('is-loading', starting);
    field($('audioState'), starting ? 'starting' : enabled ? 'on' : state.error ? 'retry' : 'off');
    $('previewDrawingMidi').disabled = !drawing?.model.count;
    $('captureDrawingFrame').disabled = !drawing?.model.count;
    const paused = state.samples.filter(sample => sample.paused).length, playing = state.samples.length - paused;
    const masterPlaying = Boolean(playing || state.automata?.playing || filePlayer?.getTransportState().playing);
    $('blechMasterPlay').setAttribute('aria-pressed', String(masterPlaying));
    $('blechMasterPlay').disabled = zeroTempo;
    $('blechMasterPlay').setAttribute('aria-label', zeroTempo ? 'Raise tempo above zero to play' : masterPlaying ? 'Pause all playback' : 'Play or resume playback');
    $('blechMasterPlay').title = zeroTempo ? '0 BPM pauses; turn the tempo up to play' : masterPlaying ? 'Pause running sources together' : masterPause ? 'Resume sources paused together' : 'Play prepared source or resume paused layers';
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
  // Worklet telemetry updates the engine's audio-clock anchor at 30 Hz. The
  // falling notes have their own animation loop; the layer rack, controls and
  // selected frame follow our 100 ms display tick instead. Edits still reflect
  // immediately, and live brush appends never rebuild the rack per point.
  engine = new MidiMixerEngine({ onState: (state, reason) => {
    if (reason !== 'clock' && !liveDrawing) reflect(state);
  }, maxTempo: MAX_MIDI_MIXER_TEMPO });
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
  const noteEffectHost = document.createElement('div'); $('blechEffectsHost').append(noteEffectHost);
  noteEffectEditor = mountMidiNoteEffectEditor(noteEffectHost, { id: 'blechNoteFx',
    getValue: () => engine.state.noteEffects, onChange: value => { engine.setNoteEffects(value); filePlayer?.setNoteEffects(value); } });
  $('blechEffectsHost').append($('mixerEffects'));
  synthEffectEditor = mountMidiSynthEffectEditor($('mixerSynthEffects'), {
    label: 'SoundFont effects', getValue: () => engine.state.effects.synth,
    onChange: synth => engine.configureEffects({ synth }),
  });
  $('drawingPlaybackOptions').append($('creativeControlsHost').querySelector('.mixer-stamp-switches'));
  $('mixerSampleLevel').closest('label').querySelector('b').textContent = 'Layer volume';
  $('mixerSampleLevel').setAttribute('aria-label', 'Generated layer volume');
  $('mixerSampleLevel').closest('label').title = 'Volume of stamps, drawings, text, math and frame layers. Automatapoeia has its own volume.';
  filePlayer = mountBlechFilePlayer($('blackMidiPlayer'), { engine, creditsHost: $('blackMidiCredits'), libraryHost: $('midiFilesTools'), settingsHost: $('midiVisualizerTools'), transportHost: $('blechFileTransport'), onPrepare: detail => preparedChanged('files', detail),
    onKeyboardNote: () => { keyboardNoteCount++; reflect(); },
    onPerformed: frame => loopCatch.record(frame),
  });
  $('blackMidiViewport').append(layerEditor);
  spigots = createBlechSpigotEngine({ engine, sendScore: (score, options) => performanceView.sendScore(score, options),
    onChange: () => { if (!liveDrawing) reflect(); }, onTransform: record => performanceView.setLayerSourceTransform(record.sampleId, record) });
  const updateMathDraft = score => {
    if (score) {
      // Keep the silent source in sync without closing the menu or resetting
      // the frame when its note controls change.
      prepared.set('math', { ...prepared.get('math'), score, artwork: mathTools.getArtwork(),
        settings: mathTools.getSettings(), error: '' });
    }
    return score;
  };
  const mathPanel = document.querySelector('.blech-workbench');
  function clearMathPanelPosition() {
    for (const property of ['left', 'right', 'top', 'bottom', 'width', 'height', 'maxHeight'])
      mathPanel.style[property] = '';
    delete mathPanel.dataset.compact;
  }
  function positionMathPanel({ left, right, top, bottom, stageRect, source }) {
    const workspace = $('blechMidi');
    if (source !== 'math' || mathMode !== 'workbox' || workspace.dataset.tab !== 'math' || workspace.dataset.panelOpen !== 'true') return;
    const area = workspace.getBoundingClientRect(), gap = 32, edgeGap = 12;
    const frame = { left: stageRect.left - area.left + left, right: stageRect.left - area.left + right,
      top: stageRect.top - area.top + top, bottom: stageRect.top - area.top + bottom };
    const minX = Math.max(8, stageRect.left - area.left + 8);
    const maxX = Math.min(area.width - 8, stageRect.right - area.left - 8);
    const minY = Math.max(8, stageRect.top - area.top + 8);
    const maxY = Math.min(area.height - 8, innerHeight - area.top - 8);
    const roomRight = maxX - frame.right - gap, roomLeft = frame.left - gap - minX;
    const stage = $('blackMidiViewport');
    const rotation = stage.querySelector('.blech-drop-rotate')?.getBoundingClientRect();
    const rotationLeft = rotation ? rotation.left - area.left : -Infinity;
    const rotationRight = rotation ? rotation.right - area.left : -Infinity;
    const rightPopupLeft = frame.right + gap;
    const rotateBlocksRight = rotation && rotationRight > rightPopupLeft
      && rotationLeft < rightPopupLeft + Math.min(340, roomRight)
      && rotation.bottom - area.top > minY && rotation.top - area.top < maxY;
    const side = roomRight >= 190 && (!rotateBlocksRight || roomLeft < 190) ? 'right' : roomLeft >= 190 ? 'left' : null;
    const width = Math.min(340, side === 'right' ? roomRight : side === 'left' ? roomLeft : maxX - minX);
    // On a narrow screen there is no lane beside the frame. Use the space
    // above/below it instead, scrolling Math's controls rather than covering
    // the frame's grips, rotate handle or its little transport.
    const aboveControls = [...stage.querySelectorAll('.blech-drop-resize:not(:disabled), .blech-drop-rotate')]
      .map(node => node.getBoundingClientRect()).filter(rect => rect.top - area.top < frame.top && rect.bottom - area.top > minY);
    const above = Math.min(frame.top, ...aboveControls.map(rect => rect.top - area.top)) - edgeGap - minY;
    const below = maxY - frame.bottom - edgeGap;
    const goAbove = !side && (above >= 96 || above >= below);
    const maxHeight = Math.min(430, side ? maxY - minY : Math.max(96, goAbove ? above : below));
    mathPanel.style.width = `${Math.max(0, width)}px`;
    mathPanel.style.height = 'auto';
    mathPanel.style.maxHeight = `${Math.max(0, maxHeight)}px`;
    mathPanel.style.right = mathPanel.style.bottom = 'auto';
    mathPanel.dataset.compact = String(width < 270);
    const height = mathPanel.offsetHeight;
    const x = side === 'right' ? frame.right + gap : side === 'left' ? frame.left - width - gap
      : Math.max(minX, Math.min(maxX - width, frame.right - width));
    const y = side ? Math.max(minY, Math.min(maxY - height, frame.top))
      : goAbove ? Math.max(minY, Math.min(frame.top, ...aboveControls.map(rect => rect.top - area.top)) - height - edgeGap)
        : Math.min(maxY - height, frame.bottom + edgeGap);
    mathPanel.style.left = `${x}px`;
    mathPanel.style.top = `${y}px`;
  }
  dropStage = mountBlechDropStage($('blechDropControls'), $('blackMidiViewport'), {
    getTempo: () => engine.state.tempo,
    getView,
    getBrush,
    getWorkboxDrawingGesture: () => ({ tool: drawingGestures.workbox, fill: geometryFill }),
    getWorkboxStamp: () => workboxStamp?.score,
    getWorkboxStampSize: () => loopStampSize,
    onDrop: (score, options) => {
      const sent = spigots.create(dropStage.getSourceScore() ?? score, options);
      if (sent) { spigotView?.setMode('select'); spigotView?.select(sent.id); }
      if (sent && activeKey() === 'drawing') { revokeDownload(); downloadUrl = URL.createObjectURL(new Blob([sent.buffer], { type: 'audio/midi' })); $('downloadDrawingMidi').href = downloadUrl; $('downloadDrawingMidi').hidden = false; }
      if (sent && activeKey() === 'catch') prepared.delete('catch');
      reflect(); return sent;
    },
    onSave: () => spigotView?.select(null),
    onSettings: settings => {
      knobs?.update($('blechDropGain')); knobs?.update($('blechDropChannel'));
      if (settings.source === 'text' && $('blechTextLoop')) $('blechTextLoop').checked = settings.loop;
    },
    onSettingsOpen: () => {
      if ($('blechMidi').dataset.tab === 'math' ||
        $('blechMidi').dataset.tab === 'workbox' && matchMedia('(max-width: 700px), (max-height: 500px)').matches) setPanelOpen(false);
    },
    onGeneratorSettings: source => { if (source === 'math') activateMathWorkbox(); },
    onRequestWorkboxStamp: () => { void chooseWorkboxStamp(workboxStampPicker.value ?? 'heart'); },
    onRequestWorkboxMath: () => openWorkboxMathMenu(),
    onWorkboxToolChange: tool => { if (tool !== 'math') closeWorkboxMathMenu(); },
    onMathNoteReset: () => updateMathDraft(mathTools?.resetNoteOptions()),
    onFrameLayout: positionMathPanel,
    onVisibility: ({ hasDraft, visible }) => {
      $('blechToolWorkbox').disabled = !hasDraft || visible;
    },
    onCancel: (source, key) => { if (key) prepared.delete(key); },
  });
  function clearGeneratorSelection() {
    // A tucked generator is not another active canvas tool. Keep one keyboard
    // entry point in its tablist, without advertising two selected tools.
    for (const tab of document.querySelectorAll('.blech-generator-tabs [data-blech-tab]')) {
      tab.setAttribute('aria-selected', 'false');
      tab.tabIndex = tab.dataset.blechTab === $('blechMidi').dataset.tab ? 0 : -1;
    }
  }
  spigotView = mountBlechSpigots($('blackMidiViewport'), {
    controlsHost: $('blechSpigotControls'),
    eraseControl: $('blechToolErase'),
    stampHost: $('blechBrushStampPicker'),
    combHost: $('blechPitchComb'),
    getLayers: () => spigots.getLayers(),
    getLiveSources: () => spigots.getLiveSources(),
    getPreparedScore: mode => (mode ?? spigotView?.getMode()) === 'stamp'
      ? canvasStampPrepared?.options.stampId === canvasStampId
        ? { score: canvasStampPrepared.score, settings: { ...canvasStampPrepared.options, ...dropStage.getSettings(),
          ...liveStampSize, name: canvasStampPrepared.options.name, source: 'frames', loop: false, rotationDegrees: 0 } }
        : { score: null }
      : ({ score: dropStage.getSourceScore(), settings: dropStage.getSettings() }),
    getStampEntries: () => performanceView.getStamps(),
    getSelectedStampId: () => canvasStampId,
    onSelectStamp: async id => {
      const score = await performanceView.prepareStamp(id);
      if (!score || disposed) return false;
      canvasStampId = id; canvasStampPrepared = performanceView.getPreparedDrop();
      stampPicker?.select(id); stampPicker?.update(performanceView.getStamps());
      return true;
    },
    getTempo: () => engine.state.tempo,
    getView,
    getBrush,
    getDrawingGesture: mode => ({ tool: drawingGestures[mode] ?? 'pencil', fill: geometryFill }),
    onCreate: (score, settings) => spigots.create(score, settings),
    onCreateMath: (score, settings) => spigots.create(score, settings),
    onCreateComb: ({ notes, delayBeats, name }) => {
      const draft = dropStage.getSettings(), title = `Pitch comb · ${name}`;
      return spigots.create(blechStrokeScore(notes, .25, title), {
        name: title, source: 'comb', channel: draft.channel, program: draft.program === 'original' ? '0' : draft.program,
        gain: Math.min(.5, .65 / Math.sqrt(notes.length / 8)), loop: false, hold: false, saveToPads: false,
        transpose: 0, widthNotes: null, heightBeats: null, rotationDegrees: 0, delayBeats,
      });
    },
    onCreateCrossing: ({ notes, block, periodBeats }) => {
      // One pinned clock source, not 128 independent clips. A rail gesture
      // cannot evict a workbox layer or another rail note.
      if (engine.state.samples.length >= MIDI_SAMPLE_LIMITS.clips)
        throw new Error('Four sounds are already playing. Stop a sound or remove a rail square to start both rails.');
      const draft = dropStage.getSettings(), name = 'Both rails · rain grid';
      return spigots.create(blechStrokeScore(notes, Math.max(4, periodBeats), name), {
        name, source: 'crossing', channel: draft.channel, program: draft.program === 'original' ? '0' : draft.program,
        gain: .04, loop: true, hold: false, pinned: true, saveToPads: false, quantize: false, block, periodBeats,
        transpose: 0, widthNotes: null, heightBeats: null, rotationDegrees: 0, delayBeats: 0,
      });
    },
    onCreateRail: ({ pitch, periodBeats, held }) => {
      // The mixer can replace its oldest clip when full. A rail gesture must
      // never quietly steal a layer (or an existing rail note).
      if (engine.state.samples.length >= MIDI_SAMPLE_LIMITS.clips)
        throw new Error('Four sounds are already playing. Stop a sound or remove a rail square to add another.');
      const draft = dropStage.getSettings(), name = `Note rail · ${held ? 'held' : `every ${periodBeats} beats`} · ${pitch}`;
      return spigots.create(blechRailNoteScore(pitch, periodBeats, held), {
        name, source: 'rail', channel: draft.channel, program: draft.program === 'original' ? '0' : draft.program,
        gain: Math.min(.5, draft.gain ?? .5), loop: !held, hold: held, periodBeats: held ? null : periodBeats,
        pinned: true, saveToPads: false, quantize: false, transpose: 0, widthNotes: null, heightBeats: null, rotationDegrees: 0, delayBeats: 0,
      });
    },
    onEdit: (id, settings) => spigots.edit(id, settings),
    onOpenSettings: id => { const source = selectLayer(id); if (source) openLayerEditor(source, document.querySelector('[data-spigot-settings]')); },
    onToggleLoop: (id, enabled) => spigots.loop(id, enabled),
    onTogglePlay: id => { const source = spigots.getLayers().find(layer => layer.id === id); if (source) masterPause?.samples.delete(source.sampleId); spigots.togglePlay(id); },
    onRemove: id => spigots.remove(id),
    onBrushStart: options => {
      const id = spigots.brushStart({ ...options, ...getBrush(), repeatBeats: brushRepeatBeats });
      if (options.mode === 'draw' && id) liveDrawing = id;
      return id;
    },
    onBrushMove: (id, point) => spigots.brushMove(id, point),
    onBrushEnd: (id, options) => {
      const ended = spigots.brushEnd(id, options);
      if (liveDrawing === id) { liveDrawing = null; reflect(); }
      return ended;
    },
    onGeometryDraft: ({ tool, start, end, points, brush, fill, prepared: draft }) => {
      const drawing = blechGeometryDrawing(tool, points ?? start, end, brush, fill);
      spigots.drawGeometry(drawing, draft);
    },
    onLatch: ({ pitch, delayBeats, prepared: draft, replaceIds = [] }) => {
      for (const id of replaceIds) spigots.remove(id);
      const repeating = Boolean(brushRepeatBeats), duration = repeating ? brushRepeatBeats : 1;
      const name = repeating ? 'Repeating note' : 'Held note';
      const note = { note: pitch, beat: 0, duration: repeating ? Math.min(1 / 16, duration / 2) : 1, channel: 0, velocity: brushVelocity };
      return spigots.create(blechStrokeScore([note], duration, name), {
        ...draft?.settings, source: 'free-draw', name, delayBeats,
        transpose: 0, widthNotes: null, heightBeats: null, rotationDegrees: 0, loop: repeating, hold: !repeating,
      })?.id ?? null;
    },
    onModeChange: mode => {
      if (mode !== 'select') { freeText?.deactivate(); closeTextMenu(); }
      dropStage.suspendInteractions(Boolean(selectedSpigot) || mode !== 'select');
      $('blechToolStamp').setAttribute('aria-pressed', String(mode === 'stamp'));
      if (mode === 'draw' || mode === 'stamp' || mode === 'erase') clearGeneratorSelection();
      if (mode === 'stamp' || mode === 'erase' || mode === 'select') closeBrushMenu();
      closeStampMenu(); closeLoopStampMenu();
    },
    onSelectionChange: id => {
      if (id) {
        freeText?.deactivate();
        if ($('blechMidi').dataset.panelOpen === 'false') clearGeneratorSelection();
      }
      selectedSpigot = id; reflectLayerSelection();
      dropStage.suspendInteractions(Boolean(id) || spigotView?.getMode() !== 'select');
    },
  });
  const applyTextScore = (id, score, options) => {
    const result = performanceView.replaceScore(id, score, options);
    if (result) spigots.adoptText(id, score);
    return result;
  };
  freeText = mountBlechFreeText($('blackMidiViewport'), {
    getTempo: () => engine.state.tempo,
    getView,
    onDrop: (score, options) => spigots.create(score, options),
    onApply: applyTextScore,
  });
  on($('midiVisualizerTools'), 'input', () => { dropStage.refresh(); spigotView.refresh(true); freeText.refresh(); });
  stampPicker = mountBlechStampPicker($('blechStampPicker'), { entries: performanceView.getStamps(), selectedId: 'heart', onSelect: id => { void performanceView.prepareStamp(id).then(() => { if (!disposed) stampPicker.update(performanceView.getStamps()); }).catch(error => field($('creativeStatus'), error.message)); } });
  let workboxStampRequest = 0;
  async function chooseWorkboxStamp(id) {
    const request = ++workboxStampRequest;
    field($('blechWorkboxStatus'), 'Preparing stamp…');
    try {
      const score = await performanceView.prepareStamp(id);
      if (disposed || request !== workboxStampRequest) return;
      const ready = score?.buffer ? { ...score, analysis: score.analysis ?? parseMidi(score.buffer) } : null;
      if (!ready?.analysis?.notes?.length) throw new Error('Choose a stamp with notes.');
      workboxStamp = { id, score: ready };
      workboxStampPicker.select(id);
      field($('blechWorkboxStatus'), 'Stamp ready. Tap or drag inside the silent box to place it; Drop when ready.');
      if ($('blechMidi').dataset.tab === 'workbox') {
        dropStage.setWorkboxTool('stamp'); dropStage.configure({ loop: true });
        closeLoopStampMenu(); setPanelOpen(false);
        document.querySelector('.blech-workbox-paint')?.focus({ preventScroll: true });
      }
    } catch (error) {
      if (!disposed && request === workboxStampRequest) field($('blechWorkboxStatus'), error.message || 'Could not prepare this stamp.');
    }
  }
  workboxStampPicker = mountBlechStampPicker($('blechWorkboxStampPicker'), {
    entries: performanceView.getStamps(), selectedId: 'heart', label: 'Loop Stamp picture', onSelect: chooseWorkboxStamp,
  });
  workboxStampPicker.element.classList.add('blech-stamp-grid-picker');
  $('blechSavedDrops').append($('mixerSavedPads'));
  $('creativePadsHost').querySelector('.mixer-stamp-palette').hidden = true;
  $('mixerStampAgain').textContent = 'Refresh preview';
  $('creativeControlsHost').querySelector('.mixer-stamp-midi > summary').textContent = 'Layer MIDI controls';
  const frameAdvanced = document.createElement('details'); frameAdvanced.className = 'blech-frame-advanced';
  const frameSummary = document.createElement('summary'); frameSummary.textContent = 'More draw controls';
  frameAdvanced.append(frameSummary, $('creativeControlsHost').querySelector('.mixer-stamp-source-controls')); $('blechPanel-frames').append(frameAdvanced);
  for (const type of ['input', 'change']) on(frameAdvanced, type, () => { if (frameMode === 'drawing') prepareDrawing(); else if (frameMode === 'stamps') void performanceView.prepareStamp(stampPicker.value); });
  const seedActions = $('automataMidiTools').querySelector('.automata-midi-seed-actions');
  $('automataMidiTools').querySelector('.automata-midi-live-transport').after(seedActions);
  $('automataMidiTools').querySelector('.automata-midi-live-transport h2').textContent = 'Live evolution';
  for (const type of ['input', 'change']) on($('drawingShapeControls'), type, () => { if (frameMode === 'drawing') prepareDrawing(); else if (frameMode === 'stamps') void performanceView.prepareStamp(stampPicker.value); });
  knobs = mountMixerKnobs($('blechMidi'), { curves: { creativeTempo: BLECH_TEMPO_CURVE } });
  artCreator = mountMidiArtCreator($('midiArtCreator'), {
    getDrawingScore: () => { const score = performanceView.getDrawingScore(); return { ...score, analysis: score.analysis ?? parseMidi(score.buffer) }; },
    getTempo: () => engine.state.tempo,
    getSourceScore: source => source === 'stamp' ? performanceView.getPreparedScore() : performanceView.getDrawingScore(),
    onPrepare: detail => { preparedChanged('art', detail); preparedChanged('scripts', detail); },
    onSend: (score, options) => sendPrepared(frameMode === 'scripts' ? 'scripts' : 'art', score, options),
    onPreview: score => filePlayer.previewScore(score),
  });
  const onDrop = source => (score, options) => sendPrepared(source, score, options);
  mathTools = mountBlechMath($('midiMathTools'), {
    getTempo: () => engine.state.tempo, onPrepare: detail => preparedChanged('math', detail),
    onWorkbox: activateMathWorkbox, onPresetPick: armMathSelection,
  });
  dropStage.attachSourceTool('math', mathTools.presetControl);
  frameTools = mountBlechFrames($('midiFramesTools'), { getDrawingScore: () => performanceView.getDrawingScore(), getTempo: () => engine.state.tempo, onDrop: onDrop('sequence'), onPrepare: detail => preparedChanged('sequence', detail), onEditDrawing: loadDrawingCopy });
  on($('captureDrawingFrame'), 'click', () => { try { const index = frameTools.capture(); field($('creativeStatus'), `Frame ${index + 1} captured. Open Frames to arrange and drop the sequence.`); } catch (error) { field($('creativeStatus'), error.message); } });
  textTools = mountBlechText($('drawingMessageHost'), { getTempo: () => engine.state.tempo,
    getProgram: () => $('mixerSampleProgram').value,
    onDrop: onDrop('text'), onPrepare: detail => preparedChanged('text', detail),
    onApply: applyTextScore,
    getLayer: id => engine.state.samples.find(sample => sample.id === id) });
  function loadTextLayer(detail) {
    if (!detail) return;
    if (detail.settings?.freeStyle) {
      activateTab('text'); freeText.edit(detail);
    } else { activateTab('text', false, true); textTools.edit(detail); }
  }
  const tabs = [...document.querySelectorAll('[data-blech-tab]')];
  const frameTabs = [...document.querySelectorAll('[data-frame-tab]')];
  const brushMenu = $('blechBrushMenu'), stampMenu = $('blechStampMenu'), loopStampMenu = $('blechLoopStampMenu'), textMenu = $('blechTextMenu');
  const freeMathMenu = $('blechFreeMathMenu'), workboxMathMenu = $('blechWorkboxMathMenu');
  const sizeSlider = $('blechBrushSize'), tipPreview = $('blechBrushPreview'), tipContext = tipPreview.getContext('2d');
  // Show the actual MIDI nib, not an interactive pitch/time grid. One size
  // widens its pitches and extends its sixteenth-beat cells together.
  function reflectBrushSize() {
    sizeSlider.value = String(brushSize);
    $('blechBrushSizeValue').value = String(brushSize);
    tipPreview.setAttribute('aria-label', `${brushNib} brush tip, size ${brushSize}`);
    tipContext.clearRect(0, 0, tipPreview.width, tipPreview.height);
    tipContext.fillStyle = '#c7ff2a';
    const pitches = brushPitches(60, brushSize), cell = 7;
    const inset = Math.floor((tipPreview.width - brushSize * cell) / 2);
    for (const mark of blechBrushImprint(60, 2, getBrush()))
      tipContext.fillRect(inset + pitches.indexOf(mark.note) * cell,
        inset + Math.round((mark.beat - 2) * 16) * cell, cell, Math.round(mark.duration * 16) * cell);
  }
  on(sizeSlider, 'input', () => {
    brushSize = Number(sizeSlider.value);
    reflectBrushSize();
    spigotView?.refresh();
  });
  reflectBrushSize();
  const drawTool = document.querySelector('[data-spigot-mode="draw"]'), brushCaret = $('blechBrushToggle');
  const stampTool = $('blechToolStamp'), stampCaret = $('blechToolStampOptions');
  const workboxDrawTool = $('blechWorkboxDraw'), workboxDrawCaret = $('blechWorkboxBrush');
  const loopStampTool = $('blechWorkboxStamp'), loopStampCaret = $('blechWorkboxStampOptions');
  const workboxMathTool = $('blechWorkboxMath'), workboxMathCaret = $('blechWorkboxMathOptions');
  const clickedCorner = (event, caret) => {
    if (caret.contains(event.target)) return true;
    if (!event.detail && !event.pointerType) return false;
    const rect = caret.getBoundingClientRect();
    return event.clientX >= rect.left && event.clientX < rect.right
      && event.clientY >= rect.top && event.clientY < rect.bottom;
  };
  const textToggle = $('blechTab-text'), textCaret = $('blechTextOptionsToggle');
  const mathToggle = $('blechTab-math'), mathCaret = $('blechMathOptionsToggle');
  function closeBrushMenu(restoreFocus = false) {
    if (brushMenu.hidden) return;
    const opener = brushMenuOwner;
    brushMenuOwner?.closest('.blech-workbox-rail')?.style.removeProperty('translate');
    brushMenu.hidden = true; brushMenuOwner = null;
    opener?.setAttribute('aria-expanded', 'false');
    if (restoreFocus) opener?.focus({ preventScroll: true });
  }
  function closeStampMenu(restoreFocus = false) {
    if (stampMenu.hidden) return;
    spigotView?.closeStampPicker();
    stampMenu.hidden = true; stampTool.setAttribute('aria-expanded', 'false');
    if (restoreFocus) stampTool.focus({ preventScroll: true });
  }
  function closeLoopStampMenu(restoreFocus = false) {
    if (loopStampMenu.hidden) return;
    workboxStampPicker?.close();
    loopStampMenu.hidden = true; loopStampTool.setAttribute('aria-expanded', 'false');
    if (restoreFocus) loopStampTool.focus({ preventScroll: true });
  }
  function closeTextMenu(restoreFocus = false) {
    if (textMenu.hidden) return;
    textMenu.hidden = true; textToggle.setAttribute('aria-expanded', 'false');
    if (restoreFocus && !freeText?.focusDraft()) textToggle.focus({ preventScroll: true });
  }
  function closeFreeMathMenu(restoreFocus = false) {
    if (freeMathMenu.hidden) return;
    mathTools.closeFreePicker(); freeMathMenu.hidden = true;
    mathToggle.setAttribute('aria-expanded', String($('blechMidi').dataset.panelOpen === 'true' && mathMode === 'free'));
    if (restoreFocus) mathToggle.focus({ preventScroll: true });
  }
  function closeWorkboxMathMenu(restoreFocus = false) {
    if (workboxMathMenu.hidden) return;
    mathTools.closeFreePicker(); workboxMathMenu.hidden = true;
    workboxMathTool.setAttribute('aria-expanded', 'false');
    if (restoreFocus) workboxMathTool.focus({ preventScroll: true });
  }
  function positionMenu(menu, opener) {
    if (menu.hidden || !opener) return;
    const rail = menu === brushMenu && brushMenu.dataset.kind === 'workbox'
      ? opener.closest('.blech-workbox-rail') : null;
    if (rail) {
      // Short stages may leave only 60px under the frame-side Draw button.
      // Lift this one rail while its brush popup is open, keeping the popup
      // below its trigger and out of the top performance transport.
      rail.style.removeProperty('translate');
      const trigger = opener.getBoundingClientRect();
      const viewportTop = $('blackMidiViewport').getBoundingClientRect().top;
      const lift = Math.max(0, Math.min(trigger.bottom - (innerHeight - 104), trigger.top - viewportTop - 8));
      if (lift) rail.style.translate = `0 -${lift}px`;
    }
    const anchor = opener.getBoundingClientRect(), width = menu.offsetWidth;
    // Corner carets sit within the icons; their popups must still clear the
    // whole transport/tool row, including bottom padding and any scrollbar.
    const rowBottom = opener.closest('#blechPlaygroundTools')
      ? Math.max(anchor.bottom, document.querySelector('.blech-action-row')?.getBoundingClientRect().bottom ?? 0)
      : anchor.bottom;
    const below = Math.max(0, innerHeight - rowBottom - 8), above = Math.max(0, anchor.top - 8);
    // Keep the Workbox brush below its frame-side trigger when there is room.
    const workboxBelow = menu === brushMenu && brushMenu.dataset.kind === 'workbox' && below >= 88;
    const showBelow = workboxBelow || below >= menu.scrollHeight || below >= above;
    menu.style.maxHeight = `${showBelow ? below : above}px`;
    menu.style.left = `${Math.max(8, Math.min(innerWidth - width - 8, anchor.left))}px`;
    menu.style.top = `${showBelow ? rowBottom + 5 : anchor.top - menu.offsetHeight - 5}px`;
  }
  function positionToolMenus() {
    positionMenu(brushMenu, brushMenuOwner);
    positionMenu(stampMenu, stampCaret);
    positionMenu(loopStampMenu, loopStampCaret);
    positionMenu(textMenu, textCaret);
    positionMenu(freeMathMenu, mathToggle);
    positionMenu(workboxMathMenu, workboxMathTool);
  }
  function reflectDrawingGesture(kind) {
    const tool = drawingGestures[kind === 'workbox' ? 'workbox' : 'draw'];
    const isShape = ['rectangle', 'ellipse', 'triangle'].includes(tool);
    for (const button of brushMenu.querySelectorAll('[data-draw-gesture]'))
      button.setAttribute('aria-pressed', String(button.dataset.drawGesture === tool));
    for (const button of brushMenu.querySelectorAll('[data-shape-fill]'))
      button.setAttribute('aria-pressed', String(button.dataset.shapeFill === geometryFill));
    $('blechShapeFill').hidden = !isShape;
    brushMenu.querySelector('.blech-brush-nibs').hidden = isShape && geometryFill === 'solid';
    $('blechBrushNoteBehavior').hidden = kind !== 'free' || tool !== 'pencil';
    spigotView?.updateDrawingTool();
    if (kind === 'workbox') dropStage?.refresh();
    positionToolMenus();
  }
  function openBrushMenu(kind, opener) {
    if (!brushMenu.hidden && brushMenuOwner === opener) { closeBrushMenu(); return; }
    closeBrushMenu(); closeStampMenu(); closeLoopStampMenu();
    brushMenuOwner = opener; brushMenu.dataset.kind = kind;
    field($('blechBrushTitle'), kind === 'workbox' ? 'Workbox Draw tools' : 'Free Draw tools');
    brushMenu.setAttribute('aria-label', `${kind === 'workbox' ? 'Workbox Draw' : 'Free Draw'} tools`);
    $('blechBrushMore').hidden = kind !== 'workbox';
    brushMenu.hidden = false; opener.setAttribute('aria-expanded', 'true'); positionToolMenus();
    reflectBrushSize();
    reflectDrawingGesture(kind);
  }
  function openStampMenu() {
    if (!stampMenu.hidden) { closeStampMenu(); return; }
    closeBrushMenu(); closeLoopStampMenu(); spigotView.refreshStamps();
    stampMenu.hidden = false; stampTool.setAttribute('aria-expanded', 'true');
    positionToolMenus(); spigotView.openStampPicker();
  }
  function openLoopStampMenu() {
    if (!loopStampMenu.hidden) { closeLoopStampMenu(); return; }
    closeBrushMenu(); closeStampMenu();
    workboxStampPicker.update(performanceView.getStamps());
    loopStampMenu.hidden = false; loopStampTool.setAttribute('aria-expanded', 'true');
    positionToolMenus(); workboxStampPicker.open();
  }
  function openTextMenu() {
    if (!textMenu.hidden) { closeTextMenu(true); return; }
    closeBrushMenu(); closeStampMenu(); closeLoopStampMenu();
    textMenu.hidden = false; textToggle.setAttribute('aria-expanded', 'true');
    positionToolMenus(); $('blechTextAdvanced').focus({ preventScroll: true });
  }
  function openFreeMathMenu() {
    if (!freeMathMenu.hidden) { closeFreeMathMenu(true); return; }
    closeWorkboxMathMenu();
    activateTab('math');
    mathTools.showFreePicker($('blechFreeMathPickerHost'));
    freeMathMenu.hidden = false; mathToggle.setAttribute('aria-expanded', 'true');
    positionToolMenus(); mathTools.openFreePicker();
    field($('blechToolStatus'), 'Choose a Math shape, then tap the graphic to place it once.');
  }
  function openWorkboxMathMenu() {
    if (!workboxMathMenu.hidden) { closeWorkboxMathMenu(true); return; }
    if ($('blechMidi').dataset.tab !== 'workbox' || dropStage.getSettings().source !== 'workbox') return;
    closeBrushMenu(); closeStampMenu(); closeLoopStampMenu(); closeTextMenu(); closeFreeMathMenu();
    field($('blechWorkboxMathStatus'), '');
    mathTools.showFreePicker($('blechWorkboxMathPickerHost'));
    workboxMathMenu.hidden = false; workboxMathTool.setAttribute('aria-expanded', 'true');
    positionToolMenus(); mathTools.openFreePicker();
  }
  on($('blechFreeMathClose'), 'click', () => closeFreeMathMenu(true));
  on($('blechWorkboxMathClose'), 'click', () => closeWorkboxMathMenu(true));
  freeMathMenu.addEventListener('keydown', event => {
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); closeFreeMathMenu(true); }
  }, { capture: true, signal: events.signal });
  workboxMathMenu.addEventListener('keydown', event => {
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); closeWorkboxMathMenu(true); }
  }, { capture: true, signal: events.signal });
  on(mathTools.presetControl.querySelector('details'), 'toggle', event => {
    if (!event.target.open && !freeMathMenu.hidden) closeFreeMathMenu(true);
    if (!event.target.open && !workboxMathMenu.hidden) closeWorkboxMathMenu(true);
  });
  on($('blechBrushClose'), 'click', () => closeBrushMenu(true));
  on($('blechStampClose'), 'click', () => closeStampMenu(true));
  on($('blechTextMenuClose'), 'click', () => closeTextMenu(true));
  on($('blechTextAdvanced'), 'click', () => { closeTextMenu(); activateTab('text', false, true); });
  on(brushMenu, 'keydown', event => { if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); closeBrushMenu(true); } });
  for (const [menu, close] of [[stampMenu, closeStampMenu], [loopStampMenu, closeLoopStampMenu], [textMenu, closeTextMenu]])
    menu.addEventListener('keydown', event => {
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close(true); }
    }, { capture: true, signal: events.signal });
  on(document, 'pointerdown', event => {
    if (!brushMenu.hidden && !brushMenu.contains(event.target) && !brushMenuOwner?.contains(event.target)) closeBrushMenu();
    if (!stampMenu.hidden && !stampMenu.contains(event.target) && !stampTool.contains(event.target)) closeStampMenu();
    if (!loopStampMenu.hidden && !loopStampMenu.contains(event.target) && !loopStampTool.contains(event.target)) closeLoopStampMenu();
    if (!textMenu.hidden && !textMenu.contains(event.target) && !textToggle.contains(event.target)) closeTextMenu();
    if (!freeMathMenu.hidden && !freeMathMenu.contains(event.target) && !mathToggle.contains(event.target)) closeFreeMathMenu();
    if (!workboxMathMenu.hidden && !workboxMathMenu.contains(event.target) && !workboxMathTool.contains(event.target)) closeWorkboxMathMenu();
  });
  on(globalThis, 'resize', positionToolMenus);
  on($('blechPlaygroundTools'), 'scroll', () => { closeBrushMenu(); closeStampMenu(); closeLoopStampMenu(); closeTextMenu(); closeFreeMathMenu(); closeWorkboxMathMenu(); });
  for (const [suffix, key] of [['Width', 'widthNotes'], ['Height', 'heightBeats']]) {
    const input = $('blechStamp' + suffix);
    on(input, 'input', () => { if (input.validity.valid) liveStampSize[key] = input.value === '' ? null : Number(input.value); });
    on(input, 'change', () => {
      if (!input.validity.valid) { input.reportValidity(); input.value = liveStampSize[key] ?? ''; }
    });
  }
  on($('blechStampNatural'), 'click', () => {
    liveStampSize.widthNotes = null; liveStampSize.heightBeats = null;
    $('blechStampWidth').value = ''; $('blechStampHeight').value = '';
  });
  const loopSizeKnob = $('blechLoopStampSize');
  loopSizeKnob.value = String(loopStampSize.scale);
  on(loopSizeKnob, 'input', () => {
    loopStampSize.scale = Number(loopSizeKnob.value);
    $('blechLoopStampSizeValue').value = `${loopStampSize.scale}×`;
    loopSizeKnob.setAttribute('aria-valuetext', `${loopStampSize.scale}× original size`);
  });
  for (const button of brushMenu.querySelectorAll('[data-draw-gesture]')) on(button, 'click', () => {
    drawingGestures[brushMenu.dataset.kind === 'workbox' ? 'workbox' : 'draw'] = button.dataset.drawGesture;
    reflectDrawingGesture(brushMenu.dataset.kind);
  });
  for (const button of brushMenu.querySelectorAll('[data-shape-fill]')) on(button, 'click', () => {
    geometryFill = button.dataset.shapeFill;
    reflectDrawingGesture(brushMenu.dataset.kind);
  });
  for (const button of brushMenu.querySelectorAll('[data-brush-nib]')) on(button, 'click', () => {
    brushNib = button.dataset.brushNib;
    for (const option of brushMenu.querySelectorAll('[data-brush-nib]')) option.setAttribute('aria-pressed', String(option === button));
    reflectBrushSize();
    spigotView?.refresh();
  });
  on($('blechBrushVelocity'), 'input', event => {
    brushVelocity = Number(event.target.value);
    $('blechBrushVelocityOut').value = String(brushVelocity);
    spigotView?.refresh();
  });
  function updateBrushRepeat(repeating) {
    brushRepeatBeats = repeating ? Number($('blechBrushRepeatBeats').value) : 0;
    $('blechBrushSingle').setAttribute('aria-pressed', String(!repeating));
    $('blechBrushPulse').setAttribute('aria-pressed', String(repeating));
    $('blechBrushRepeatRate').hidden = !repeating;
  }
  on($('blechBrushSingle'), 'click', () => updateBrushRepeat(false));
  on($('blechBrushPulse'), 'click', () => updateBrushRepeat(true));
  on($('blechBrushRepeatBeats'), 'change', () => updateBrushRepeat(true));
  on($('blechBrushMore'), 'click', () => { closeBrushMenu(); activateTab('drawing', true); });
  function setPanelOpen(open) {
    $('blechMidi').dataset.panelOpen = String(open);
    $('blechToolSettings').setAttribute('aria-expanded', String(open && ['sound', 'visuals'].includes($('blechMidi').dataset.tab)));
    mathToggle.setAttribute('aria-expanded', String(!freeMathMenu.hidden || open && mathMode === 'free' && $('blechMidi').dataset.tab === 'math'));
    if (!open || mathMode !== 'workbox' || $('blechMidi').dataset.tab !== 'math') clearMathPanelPosition();
    dropStage?.refresh();
  }
  function setLayersExpanded(expanded) {
    const panel = $('blechLayers');
    if (!expanded && layerEditorReturn?.closest('#blechLayers')) closeLayerEditor();
    panel.dataset.expanded = String(expanded);
    panel.hidden = !expanded;
    // Settings keeps its current tab and scroll position underneath Layers.
    // It cannot take keyboard focus until the independent panel is closed.
    $('blechMidi').querySelector('.blech-workbench').inert = expanded;
    reflectLayersButtons();
    $('blechLayersToggle').title = expanded ? 'Close layers' : 'Open layers';
    $('blechLayersClose').hidden = !expanded;
    if (!expanded) {
      $('blechSavedDrops').open = false;
      for (const node of layerNodes.values()) {
        node.dataset.advanced = 'false';
        node.querySelector('[data-layer-mix]').setAttribute('aria-expanded', 'false');
        node.querySelector('.blech-layer-advanced').hidden = true;
      }
    }
    dropStage?.refresh();
  }
  function activateFrame(name, focus = false) {
    spigotView?.select(null);
    // Advanced generators share the Workbox entrance, but retain their own
    // silent prepared scores and the editable drawing/image/sequence routes.
    spigotView?.setMode('select');
    frameMode = name;
    $('blechPanel-workbox').hidden = true; $('blechPanel-frames').hidden = false;
    $('blechTab-workbox').setAttribute('aria-controls', 'blechPanel-frames');
    $('blechMidi').dataset.tab = 'frames'; setPanelOpen(true);
    for (const tab of frameTabs) { const active = tab.dataset.frameTab === name; tab.setAttribute('aria-selected', String(active)); tab.tabIndex = active ? 0 : -1; }
    for (const id of ['stamps', 'drawing', 'art', 'sequence']) $('blechPanel-' + id).hidden = id !== (name === 'scripts' ? 'art' : name);
    $('blechPanel-art').setAttribute('aria-labelledby', 'blechTab-' + (name === 'scripts' ? 'scripts' : 'art'));
    $('blechMidi').dataset.frame = name;
    $('drawingShapeControls').hidden = !['stamps', 'drawing'].includes(name);
    artCreator?.setMode(name === 'scripts' ? 'scripts' : 'images');
    if (name === 'drawing') { drawing.render(); prepareDrawing(); }
    if (name === 'stamps' && !prepared.has('stamps')) void performanceView.prepareStamp(stampPicker.value);
    field($('blechPanelTitle'), { drawing: 'Drawing grid', stamps: 'Stamps', art: 'Images', scripts: 'Scripts', sequence: 'Sequence' }[name]);
    if (focus) frameTabs.find(tab => tab.dataset.frameTab === name)?.focus({ preventScroll: true });
    showPrepared(activeKey());
  }
  function activateTab(name, focus = false, advancedText = false, advancedMath = false) {
    closeBrushMenu(); closeStampMenu(); closeLoopStampMenu(); closeFreeMathMenu(); closeWorkboxMathMenu();
    if (name !== 'text' || advancedText) { closeTextMenu(); freeText?.deactivate(); }
    if (!['sound', 'visuals', 'effects'].includes(name)) spigotView?.select(null);
    if (['stamps', 'drawing', 'art', 'scripts', 'sequence'].includes(name)) {
      activateTab('workbox'); activateFrame(name, focus); return;
    }
    $('blechTab-workbox').setAttribute('aria-controls', 'blechPanel-workbox');
    $('blechPanel-frames').hidden = true;
    if (name === 'catch') {
      spigotView?.setMode('select');
      for (const tab of tabs) { tab.setAttribute('aria-selected', 'false'); tab.tabIndex = tab.dataset.blechTab === 'workbox' ? 0 : -1; }
      for (const panel of document.querySelectorAll('.blech-preparation > [role="tabpanel"]')) panel.hidden = true;
      $('blechPanel-catch').hidden = false; $('blechDropControls').hidden = false;
      $('blechMidi').dataset.tab = 'catch'; field($('blechPanelTitle'), 'Loop Select'); setPanelOpen(true);
      showPrepared('catch'); return;
    }
    $('blechPanel-catch').hidden = true;
    if (name === 'math') mathMode = advancedMath ? 'workbox' : 'free';
    const selected = tabs.find(tab => tab.dataset.blechTab === name) ?? tabs[0]; name = selected.dataset.blechTab;
    for (const tab of tabs) {
      const active = tab === selected;
      tab.setAttribute('aria-selected', String(active)); tab.tabIndex = active ? 0 : -1;
      $(tab.getAttribute('aria-controls')).hidden = !active;
    }
    // Both keyboard tab groups keep an entry point, even when Settings is closed.
    for (const group of document.querySelectorAll('.blech-settings-tabs, .blech-generator-tabs')) if (!group.querySelector('[tabindex="0"]')) group.querySelector('[role="tab"]').tabIndex = 0;
    $('blechMidi').dataset.tab = name;
    setPanelOpen(name !== 'workbox' && (name !== 'text' || advancedText) && (name !== 'math' || advancedMath));
    if (!['sound', 'visuals'].includes(name) || spigotView?.getMode() !== 'select') spigotView?.setMode('select');
    $('blechDropControls').hidden = ['sound', 'visuals', 'effects'].includes(name);
    if (name === 'workbox') {
      dropStage.startWorkbox();
      field($('blechToolStatus'), 'Draw or stamp inside the silent box. Choose Loop, then Drop when it is ready.');
    }
    else if (name === 'math' && !advancedMath) {
      dropStage.hide();
      field($('blechToolStatus'), 'Choose a Math shape from the icon, then tap the graphic to place it. The corner arrow edits formulas or opens a workbox.');
    }
    else if (name === 'math') {
      try {
        prepared.set('math', { ...prepared.get('math'), score: mathTools.getScore(), settings: mathTools.getSettings(), error: '' });
      } catch (error) { prepared.set('math', { ...prepared.get('math'), score: null, error: error.message }); }
      dropStage.attachSourceTool('math', mathTools.presetControl);
      showPrepared('math');
    }
    else if (name === 'text' && !advancedText) {
      dropStage.hide();
      freeText.activate();
      field($('blechToolStatus'), 'Tap above the keyboard for font tools beside your cursor. Return or a new spot drops once; Escape cancels.');
    }
    else if (['sound', 'visuals', 'effects'].includes(name)) dropStage.hide();
    else showPrepared(name);
    field($('blechPanelTitle'), { workbox: 'Workbox', math: 'Math', files: 'File', text: 'Type', automata: 'Automata', effects: 'Effects', sound: 'Settings · Sound', visuals: 'Settings · Visualizer' }[name]);
    if (focus) selected.focus({ preventScroll: true });
  }
  function activateMathWorkbox() { activateTab('math', false, false, true); }
  function armMathSelection() {
    if ($('blechMidi').dataset.tab === 'workbox' && !workboxMathMenu.hidden) {
      try {
        if (!dropStage.setWorkboxMath(mathTools.getScore())) throw new Error('This Math shape cannot fit in the workbox.');
        closeWorkboxMathMenu(); setPanelOpen(false);
        field($('blechToolStatus'), 'Tap inside this workbox to add the Math shape; Drop when ready.');
      } catch (error) { field($('blechWorkboxMathStatus'), error.message || 'Choose a smaller Math shape.'); }
      return;
    }
    armFreeMath();
  }
  function armFreeMath() {
    if (mathMode !== 'free' || $('blechMidi').dataset.tab !== 'math') return;
    try {
      const score = mathTools.getScore(), notes = score.analysis?.notes ?? parseMidi(score.buffer).notes;
      if (!notes.length) throw new Error('Choose a Math formula with notes first.');
      const size = dropScoreDimensions(score, { widthNotes: 48 });
      const name = mathTools.getSettings().name;
      // Resize once on selection, never while the cursor moves. Its fixed
      // graph envelope lets the outline and the eventual MIDI share a frame.
      const resized = resizeDropScore(score, { widthNotes: size.width, heightBeats: Math.min(4, size.heightBeats) });
      const placed = { ...resized, pitchRange: { low: size.low, high: size.high } };
      closeFreeMathMenu(); setPanelOpen(false);
      spigotView.armMath(placed, { source: 'math', name: `Free Math · ${name}`,
        channel: 0, program: '0', gain: .75, loop: false, hold: false, rotationDegrees: 0 });
      field($('blechToolStatus'), `${name} ready. Tap the graphic to place once; tap again for another.`);
    } catch (error) { field($('blechToolStatus'), error.message || 'Choose a Math formula with notes first.'); }
  }
  function openMathOptions() {
    if (mathMode === 'free' && $('blechMidi').dataset.tab === 'math' && $('blechMidi').dataset.panelOpen === 'true') {
      setPanelOpen(false); mathToggle.focus({ preventScroll: true }); return;
    }
    activateTab('math');
    mathTools.showFreePicker();
    setPanelOpen(true);
  }
  function wireTabs(list, attribute, activate) {
    list.forEach(tab => {
      on(tab, 'click', event => {
        if (tab === textToggle && textCaret.contains(event.target)) { openTextMenu(); return; }
        if (tab === mathToggle && clickedCorner(event, mathCaret)) { openMathOptions(); return; }
        if (tab === textToggle) closeTextMenu();
        if (tab === mathToggle) openFreeMathMenu();
        else activate(tab.dataset[attribute]);
        if (tab.id === 'blechTab-text' && event.detail === 0) freeText?.activate({ focus: true });
      });
      on(tab, 'keydown', event => {
        if (tab.id === 'blechTab-text' && event.key === 'ArrowDown') { event.preventDefault(); openTextMenu(); return; }
        if (tab === mathToggle && event.key === 'ArrowDown') { event.preventDefault(); openMathOptions(); return; }
        const siblings = list.filter(other => other.closest('[role="tablist"]') === tab.closest('[role="tablist"]')), index = siblings.indexOf(tab);
        const next = { ArrowRight: (index + 1) % siblings.length, ArrowLeft: (index + siblings.length - 1) % siblings.length, Home: 0, End: siblings.length - 1 }[event.key];
        if (next !== undefined) { event.preventDefault(); activate(siblings[next].dataset[attribute], true); }
      });
    });
  }
  wireTabs(tabs, 'blechTab', activateTab);
  wireTabs(frameTabs, 'frameTab', activateFrame);
  on($('blechWorkboxMore'), 'click', () => { dropStage.closeWorkboxMenu(); activateFrame(frameMode, true); });
  on($('blechWorkboxBack'), 'click', () => {
    activateTab('workbox'); $('blechWorkboxAddToggle').focus({ preventScroll: true });
  });
  on($('blechNewLoopDraw'), 'click', () => {
    activateTab('workbox'); dropStage.setWorkboxTool('draw');
    field($('blechToolStatus'), 'Draw inside the silent workbox. Choose Loop, then Drop.');
  });
  on(workboxDrawTool, 'click', event => {
    if (!clickedCorner(event, workboxDrawCaret)) { closeBrushMenu(); return; }
    dropStage.setWorkboxTool('draw'); openBrushMenu('workbox', workboxDrawTool);
  });
  on(workboxDrawTool, 'keydown', event => {
    if (event.key !== 'ArrowDown') return;
    event.preventDefault(); dropStage.setWorkboxTool('draw'); openBrushMenu('workbox', workboxDrawTool);
  });
  on(loopStampTool, 'click', event => {
    if (clickedCorner(event, loopStampCaret)) openLoopStampMenu();
  });
  on(loopStampTool, 'keydown', event => {
    if (event.key === 'ArrowDown') { event.preventDefault(); openLoopStampMenu(); }
  });
  on(workboxMathTool, 'click', event => {
    if (clickedCorner(event, workboxMathCaret)) openWorkboxMathMenu();
  });
  on(workboxMathTool, 'pointerdown', event => {
    // Math's main button opens its picker on touch pointerup. Prevent the
    // following synthetic click from focusing the button and dismissing that
    // picker; leave the corner caret's click path intact.
    if (event.pointerType === 'touch' && !clickedCorner(event, workboxMathCaret)) event.preventDefault();
  });
  on(workboxMathTool, 'keydown', event => {
    if (event.key === 'ArrowDown') { event.preventDefault(); openWorkboxMathMenu(); }
  });
  on($('blechWorkboxNew'), 'click', () => {
    spigotView.setMode('select'); spigotView.select(null);
    dropStage.startWorkbox({ fresh: true });
    field($('blechToolStatus'), 'New silent workbox. Choose Draw or Stamp; Drop when ready.');
  });
  on($('blechWorkboxAdd'), 'click', () => {
    const key = $('blechWorkboxShape').value, score = prepared.get(key)?.score;
    const added = dropStage.appendWorkboxShape(score);
    field($('blechWorkboxStatus'), added ? `${prepared.get(key)?.settings?.name || key} added; still silent until Drop.`
      : score ? 'This shape cannot fit in the workbox. Try a smaller one.' : `Prepare ${$('blechWorkboxShape').selectedOptions[0].textContent} first, then return to this box.`);
    if (added) dropStage.closeWorkboxMenu();
  });
  on($('blechToolWorkbox'), 'click', () => {
    freeText.deactivate(); closeTextMenu();
    spigotView.setMode('select'); spigotView.select(null); dropStage.show(); setPanelOpen(false);
    document.querySelector('.blech-drop-handle')?.focus({ preventScroll: true });
  });
  on($('blechPanelToggle'), 'click', () => {
    setPanelOpen(false);
    ($('blechTab-' + $('blechMidi').dataset.tab) ?? $('blechTab-workbox')).focus({ preventScroll: true });
  });
  on($('blechLayersToggle'), 'click', () => {
    const expanded = $('blechLayers').dataset.expanded !== 'true';
    setLayersExpanded(expanded);
    if (expanded) $('blechLayersClose').focus({ preventScroll: true });
  });
  on($('blechLayersClose'), 'click', () => { setLayersExpanded(false); $('blechLayersToggle').focus({ preventScroll: true }); });
  on($('blechToolSettings'), 'click', () => {
    if (['sound', 'visuals'].includes($('blechMidi').dataset.tab) && $('blechMidi').dataset.panelOpen === 'true') setPanelOpen(false);
    else activateTab('sound');
  });
  function catchLastFourBeats() {
    const state = engine.state, score = loopCatch.capture(state.sampleTime, state.tempo);
    if (!score) { field($('blechToolStatus'), 'Play something first, then catch the last four beats.'); return; }
    activateTab('catch');
    preparedChanged('catch', { score, settings: { name: 'Caught · last four beats', loop: true, channel: null, program: 'original' } });
    dropStage.configure({ loop: true, channel: null, program: 'original', delayBeats: 2 });
    setPanelOpen(false);
    field($('blechToolStatus'), `${score.analysis.noteCount} recent notes in the workbox. Drop when ready.`);
  }
  on($('blechToolLoopSelect'), 'click', catchLastFourBeats);
  on($('blechCatchAgain'), 'click', catchLastFourBeats);
  const clearEverything = () => {
    closeBrushMenu(); closeStampMenu(); closeLoopStampMenu(); closeTextMenu(); closeFreeMathMenu(); closeWorkboxMathMenu(); freeText.deactivate();
    masterPause = null; zeroPausedPlayback = false; spigotView?.cancelGesture(); spigots?.clearAll();
    performanceView.stopSamples(); performanceView.clearSavedPads(); engine.setAutomataPlaying(false);
    filePlayer.clearSelection(); filePlayer.releaseKeyboard();
    dropStage.discard(); dropStage.clearWorkbox(); drawing.loadPixels([]); prepared.clear(); loopCatch.clear();
    workboxStampRequest++; workboxStamp = null; spigotView.setMode('select'); spigotView.select(null);
    setPanelOpen(false);
    field($('blechToolStatus'), 'All layers, saved drops and drafts deleted. Audio remains in its current state.');
    reflect();
  };
  on($('blechToolClear'), 'click', clearEverything);
  on($('blechLayersClear'), 'click', clearEverything);
  on(drawTool, 'click', event => {
    setPanelOpen(false);
    if (clickedCorner(event, brushCaret)) openBrushMenu('free', drawTool);
    else { closeBrushMenu(); closeStampMenu(); closeLoopStampMenu(); }
  });
  on(drawTool, 'keydown', event => {
    if (event.key !== 'ArrowDown') return;
    event.preventDefault(); spigotView?.setMode('draw');
    setPanelOpen(false); openBrushMenu('free', drawTool);
  });
  on(stampTool, 'click', event => {
    if (stampCaret.contains(event.target)) { setPanelOpen(false); openStampMenu(); return; }
    closeBrushMenu(); closeStampMenu(); closeLoopStampMenu(); setPanelOpen(false); spigotView.activateStamp();
  });
  on(stampTool, 'keydown', event => {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setPanelOpen(false); openStampMenu();
    }
  });
  on($('blechToolErase'), 'click', () => {
    closeBrushMenu(); closeStampMenu(); closeLoopStampMenu(); setPanelOpen(false);
  });
  activateMathWorkbox();
  const hashTab = () => {
    const name = { '#automata': 'automata', '#automataMidiTools': 'automata', '#drawingEditor': 'drawing', '#midiArtCreator': 'art', '#blackMidiPlayer': 'files', '#black-midi': 'files' }[location.hash];
    if (name) activateTab(name);
  };
  on(globalThis, 'hashchange', hashTab); hashTab();
  if (!location.hash) setPanelOpen(false);
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
    const playing = Boolean(running.length || state.automata.playing || file.playing);
    if (playing || filePlayer.keyboardHeldCount) {
      spigotView?.cancelGesture();
      filePlayer.releaseKeyboard();
      if (playing) {
        const snapshot = masterPause ?? { samples: new Map(), file: null, automata: false };
        for (const sample of running) {
          const paused = engine.setSamplePaused(sample.id, true);
          if (paused) snapshot.samples.set(sample.id, { scoreVersion: paused.scoreVersion, playbackEpoch: paused.playbackEpoch });
        }
        if (file.playing) snapshot.file = filePlayer.pause();
        if (state.automata.playing) { engine.setAutomataPlaying(false); snapshot.automata = true; }
        masterPause = snapshot;
      }
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
      else if (!freeText.active && spigotView.getMode() !== 'math') dropStage.send();
    }
    reflect();
  }
  on($('blechMasterPlay'), 'click', toggleMasterPlayback);
  for (const id of ['automataMidiPlayPause', 'automataMidiRestart']) on($(id), 'click', () => { if (masterPause) masterPause.automata = false; });
  on($('blechResetNoteCount'), 'click', () => { filePlayer.resetNoteCount(); engine.resetNoteCount(); keyboardNoteCount = 0; reflect(); });
  for (const button of document.querySelectorAll('[data-drawing-stamp]')) on(button, 'click', () => drawing.stamp(button.dataset.drawingStamp));
  function applyMasterTempo(next) {
    if (!Number.isFinite(next) || next < 0) return;
    if (next === 0) {
      if (!zeroTempo) {
        zeroTempo = true;
        const state = engine.state;
        zeroPausedPlayback = state.samples.some(sample => !sample.paused) || state.automata.playing || filePlayer.getTransportState().playing;
        if (zeroPausedPlayback) toggleMasterPlayback();
      }
      value($('creativeTempo'), 0);
      $('creativeTempoOut').value = '0 BPM · paused';
      $('creativeTempo').setAttribute('aria-valuetext', '0 BPM, paused');
      if (document.activeElement !== $('creativeTempoExact')) $('creativeTempoExact').value = '0';
      reflect(); return;
    }
    const fromZero = zeroTempo; zeroTempo = false;
    const tempo = engine.setTempo(next), exact = String(Number(tempo.toFixed(1)));
    value($('creativeTempo'), Math.min(1000, tempo));
    $('creativeTempoOut').value = `${exact} BPM`;
    $('creativeTempo').setAttribute('aria-valuetext', `${exact} BPM${tempo > 1000 ? ', beyond dial range' : ''}`);
    if (document.activeElement !== $('creativeTempoExact')) $('creativeTempoExact').value = exact;
    textTools.refreshTempo(); frameTools.refreshTempo();
    filePlayer.setTempo(); dropStage.refresh(); freeText.refresh();
    if (spigotView?.getMode() === 'math') spigotView.refresh(true);
    if (fromZero && zeroPausedPlayback && masterPause) toggleMasterPlayback();
    zeroPausedPlayback = false; reflect();
  }
  on($('creativeTempo'), 'input', () => applyMasterTempo(Number($('creativeTempo').value)));
  on($('creativeTempoExact'), 'input', event => {
    if (!event.target.validity.valid || event.target.value === '') return;
    applyMasterTempo(Number(event.target.value));
  });
  on($('creativeTempoExact'), 'change', () => { $('creativeTempoExact').value = zeroTempo ? '0' : String(Number(engine.state.tempo.toFixed(1))); });
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
  $('blechPanel-sound').append($('blechPanel-files').querySelector('.blech-gm-banks'));
  on($('blechShowBanks'), 'click', () => { activateTab('sound'); $('mixerBankChooser').scrollIntoView({ block: 'nearest' }); $('mixerBankChooser').querySelector('summary')?.focus({ preventScroll: true }); });
  on($('audioButton'), 'click', async () => {
    audioIntent = !(starting ? audioIntent : engine.state.audioEnabled);
    if (!audioIntent) { spigotView?.cancelGesture(); spigots?.stopAll(); masterPause = null; zeroPausedPlayback = false; starting = false; performanceView.cancelPending(); engine.setAudioEnabled(false); filePlayer.setAudioEnabled(false); reflect(); return; }
    starting = true; field($('creativeStatus'), '');
    // Creating and resuming the native context stays inside this explicit gesture.
    const pending = engine.enableAudio(); reflect();
    try { if (await pending && !disposed && audioIntent) await filePlayer.enableAudio(); }
    finally { if (!disposed) { starting = false; if (!audioIntent) { engine.setAudioEnabled(false); filePlayer.setAudioEnabled(false); } reflect(); } }
  });
  function tick(now) {
    frame = null; if (disposed || document.hidden) return;
    if (now - lastReflect > 100) reflect();
    frame = requestAnimationFrame(tick);
  }
  on(document, 'visibilitychange', () => {
    performanceView.setActive(!document.hidden);
    if (document.hidden) { if (frame !== null) cancelAnimationFrame(frame); frame = null; }
    else { drawing.render(); if (frame === null) frame = requestAnimationFrame(tick); }
  });
  on(globalThis, 'pagehide', () => {
    if (disposed) return;
    masterTapObserver?.disconnect();
    retainedDraft = drawing.model.pixels.map(row => [...row]);
    disposed = true; audioIntent = false; masterPause = null; bankChooser?.dispose(); revokeDownload(); events.abort();
    if (frame !== null) cancelAnimationFrame(frame);
    $('drawingPlaybackOptions').querySelector('.mixer-stamp-switches')?.remove();
    loopCatch.clear();
    freeText?.dispose(); spigotView?.dispose(); spigots?.dispose(); dropStage.dispose(); stampPicker.dispose(); workboxStampPicker.dispose(); frameAdvanced.remove(); prepared.clear(); textTools.dispose(); mathTools.dispose(); frameTools.dispose(); artCreator.dispose(); filePlayer.dispose(); performanceView.dispose(); noteEffectEditor.destroy(); drawing.destroy(); synthEffectEditor.destroy(); knobs.destroy(); void engine.dispose();
  });
  performanceView.setView('draw'); performanceView.setActive(!document.hidden); reflect();
  if (!document.hidden) frame = requestAnimationFrame(tick);
  void fetch(new URL('../../../assets/midiphoria/collection.json', import.meta.url), { signal: events.signal })
    .then(response => { if (!response.ok) throw new Error('File stamps could not load. Drawings and generated patterns are ready.'); return response.json(); })
    .then(collection => { if (!disposed) { performanceView.setCollection(collection); filePlayer.setCollection(collection);
      stampPicker.update(performanceView.getStamps()); workboxStampPicker.update(performanceView.getStamps()); } })
    .catch(error => { if (!disposed && error.name !== 'AbortError') field($('creativeStatus'), error.message); });
}

mountBlechMidi();
globalThis.addEventListener('pageshow', event => { if (event.persisted) mountBlechMidi(); });

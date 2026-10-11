import { mountMidiPerformanceMonitor } from './midi-mixer-monitor.js';
import { mountAutomataMidiControls } from '../midiphoria/midiphoria-automata-controls.js';
import { generateAutomataMidi } from '../midiphoria/midiphoria-automata-midi.js';
import { GM_PROGRAM_NAMES, parseMidi } from './midi-mixer-model.js';
import { createMidiFileStamp } from './midi-mixer-file-stamps.js';
import { transformMidiStamp } from './midi-mixer-score-transform.js';
import { mountMidiParameterEditor } from './midi-mixer-midi-editor.js';
import { MIXER_SAMPLE_STAMPS, mixerStampScore, nextMixerStampVariation, mixerMessageScore, mixerPerformanceScore } from './midi-mixer-performance-score.js';

const clock = () => performance.now() / 1000;
const clamp = (value, low, high) => Math.max(low, Math.min(high, value));

/** Combined graphic and sample controls. Audio stays exclusively in the engine. */
export function mountMixerPerformance(host, { engine, getDrawing, visualizerHost, volumeHost, automataHost, drawingButton } = {}) {
  const section = document.createElement('section'); section.className = 'mixer-performance';
  section.setAttribute('aria-label', 'Combined MIDI performance');
  section.innerHTML = `<div class="mixer-performance-toolbar">
    <label>Picture <select id="mixerPerformanceView"><option value="trails">Note trails</option><option value="radial">Radial</option><option value="ribbons">Ribbons</option><option value="orbit">Orbit</option></select></label>
    <span class="mixer-performance-key">A + B + samples</span>
  </div>
  <canvas id="mixerPerformanceCanvas" tabindex="0" aria-describedby="mixerStampHint" aria-label="Combined MIDI notes: pitch runs left to right and time rises from bottom to top">Both decks and sample notes appear together, colored by voice.</canvas>
  <div class="mixer-stamp-palette"><label class="sr-only" for="mixerStampFilter">Filter stamps</label>
    <input id="mixerStampFilter" type="search" placeholder="Filter stamps: zigzag, glob, black MIDI…" autocomplete="off" />
    <div class="mixer-stamp-bank-heading"><span>Stamps</span><output id="mixerStampCount"></output></div>
    <div class="mixer-sample-bank" role="group" aria-label="MIDI stamps"></div>
  </div>
  <div id="mixerAutomataTools"></div>
  <div class="mixer-stamp-shape-controls">
    <label>Density <output id="mixerStampDensityOut">50%</output><input id="mixerStampDensity" type="range" min="0" max="1" step=".05" value=".5" /></label>
    <label>Pitch span <output id="mixerStampSpanOut">48 notes</output><input id="mixerStampSpan" type="range" min="12" max="128" step="1" value="48" /></label>
    <label>Length <output id="mixerStampBeatsOut">8 beats</output><input id="mixerStampBeats" type="range" min="4" max="32" step="4" value="8" /></label>
    <div class="mixer-stamp-actions"><button id="mixerStampAgain" type="button">Stamp again</button><button id="mixerStampVariation" type="button">Variation</button><button id="mixerStampNextSlice" type="button" hidden>Next slice</button></div>
    <label class="mixer-stamp-paint"><input id="mixerStampPaint" type="checkbox" checked />Paint flow</label>
    <span id="mixerStampHint">Tap a stamp, or drag across the flow to place it by pitch.</span>
  </div>
  <div class="mixer-stamp-switches" role="group" aria-label="Stamp playback">
    <label title="Repeat stamps until stopped. Turn off to finish the current cycle."><input id="mixerSampleLoop" type="checkbox" />Loop</label>
    <label title="Follow the master tempo and launch on the next beat while the mix is playing. Turn off to use source timing."><input id="mixerSampleSync" type="checkbox" checked />Sync to tempo</label>
  </div>
  <div class="mixer-sample-controls">
    <label>Sample sound <select id="mixerSampleProgram"></select></label>
    <label class="control mixer-source-volume"><span><b>Black MIDI</b><output id="mixerSampleLevelOut" for="mixerSampleLevel">70%</output></span><input id="mixerSampleLevel" aria-label="Black MIDI volume" type="range" min="0" max="1" step="0.01" value="0.7" /></label>
    <button id="mixerSendDrawing" type="button">Play drawing</button>
    <button id="mixerStopSamples" type="button">Stop samples</button>
  </div>
  <details class="mixer-stamp-midi"><summary>Stamp MIDI</summary>
    <div class="mixer-stamp-live-midi"></div>
    <div class="mixer-stamp-source-controls" role="group" aria-label="Next stamp source settings">
      <p class="midiphoria-help">Source settings apply to the next stamp, drawing or message.</p>
      <label>Pattern seed <input id="mixerStampSeed" type="number" min="0" max="4294967295" step="1" value="1" /></label>
      <label>Key gate <output id="mixerStampGateOut">100%</output><input id="mixerStampGate" type="range" min=".01" max="1" step=".01" value="1" /></label>
      <span class="midiphoria-help">Source sustain pedals can hold notes beyond the key gate.</span>
      <div class="mixer-stamp-file-controls" hidden>
        <label>File window <select id="mixerStampSourceMode"><option value="auto">Default window</option><option value="dense">Densest slice</option><option value="manual">Choose start</option><option value="whole">Whole file, fit to Length</option></select></label>
        <label>Start beat <input id="mixerStampStart" type="number" min="0" max="4000000" step=".25" value="0" disabled /></label>
      </div>
      <label>Message layout <select id="mixerStampTextMode"><option value="word">Whole words</option><option value="letter">One letter at a time</option></select></label>
      <label>Drawing row length <input id="mixerStampDrawRow" type="number" min=".125" max="1" step=".0625" value=".25" /> beats</label>
      <label>Drawing lowest note <input id="mixerStampDrawBase" type="number" min="0" max="80" step="1" value="48" /></label>
      <button id="mixerStampResetSource" type="button">Reset source settings</button>
    </div>
  </details>
  <form class="mixer-sample-message"><label class="sr-only" for="mixerSampleMessage">Message as MIDI</label>
    <input id="mixerSampleMessage" type="text" maxlength="64" placeholder="Send a word, 🙂 ⭐ ❤ …" autocomplete="off" spellcheck="false" />
    <button id="mixerSendMessage" type="submit">Send</button>
  </form>
  <p id="mixerSampleStatus" class="midiphoria-help" role="status"></p>
  <a id="mixerStampCredit" class="mixer-stamp-credit" target="_blank" rel="noopener" hidden></a>`;
  host.append(section);
  // These nodes may live in separate view hosts; retain the single instances.
  const nodes = new Map([...section.querySelectorAll('[id]')].map(node => [node.id, node]));
  const $ = id => nodes.get(id), canvas = $('mixerPerformanceCanvas'), automataTools = $('mixerAutomataTools');
  const visualizer = document.createElement('div'); visualizer.className = 'mixer-performance-visualizer';
  visualizer.append(section.querySelector('.mixer-performance-toolbar'), canvas);
  if (visualizerHost) visualizerHost.append(visualizer); else section.prepend(visualizer);
  const volume = $('mixerSampleLevel').closest('label');
  if (volumeHost) volumeHost.append(volume);
  if (automataHost) automataHost.append(automataTools);
  const events = new AbortController();
  const on = (node, type, listener) => node.addEventListener(type, listener, { signal: events.signal });
  let active = false, disposed = false;
  const monitor = mountMidiPerformanceMonitor(canvas, { engine,
    onFrame: state => { $('mixerStopSamples').disabled = !(state.samples?.length) && !loadingSample; } });
  const renderer = monitor.renderer;
  const stamps = new Map(), buttons = new Map(), fileCache = new Map();
  let automataSelected = false, viewMode = 'draw';
  let selected = 'heart', seed = 1, request = null, requestTicket = 0, loadingSample = false, previewFrame = null;
  let patternProgram = '0', fileProgram = 'original', fileStart = null, lastFileStamp = null, nextVariation = null, pointer = null;
  $('mixerSampleProgram').add(new Option('Original file instruments', 'original'));
  GM_PROGRAM_NAMES.forEach((name, program) => $('mixerSampleProgram').add(new Option(`${program + 1}. ${name}`, String(program))));
  $('mixerSampleProgram').value = '0';
  const internalDrawing = typeof getDrawing === 'function' && !automataHost && !drawingButton;
  $('mixerSendDrawing').hidden = !internalDrawing;
  const midiEditor = mountMidiParameterEditor(section.querySelector('.mixer-stamp-live-midi'), {
    label: 'Stamp sound', getValue: () => engine.state.sampleMidi ?? {},
    excludeFields: ['program'],
    onChange: partial => {
      engine.configureSamples({ midi: partial });
      if (partial === null) { patternProgram = '0'; fileProgram = 'original'; $('mixerSampleProgram').value = stamps.get(selected)?.file && !automataSelected ? fileProgram : patternProgram; }
      midiEditor.refresh();
    },
    onAction: action => {
      if (action.kind === 'cc') return engine.sendSampleController(action.controller, action.value);
      if (action.kind === 'parameter') return engine.sendSampleParameter(action);
      return false;
    },
  });

  function editScore(score) {
    const gateScale = Number($('mixerStampGate').value);
    if (gateScale === 1) return score;
    const edited = transformMidiStamp(score, { gateScale });
    return { ...score, ...edited, pixels: undefined, durationBeats: edited.analysis.durationBeats,
      warnings: [...(score.warnings ?? []), ...edited.warnings] };
  }
  function playScore(rawScore, label, detail = '', program = $('mixerSampleProgram').value) {
    const score = editScore(rawScore);
    if (!score?.buffer) throw new Error('Draw a score first in BLECH MIDI.');
    engine.triggerSample(score.buffer, { name: label, program: null, gain: Number($('mixerSampleLevel').value),
      loop: $('mixerSampleLoop').checked, sync: $('mixerSampleSync').checked,
      midi: { ...(engine.state.sampleMidi ?? {}), program: program === 'original' ? null : Number(program) } });
    canvas.dataset.message = label;
    $('mixerSampleStatus').textContent = `${label} · ${engine.state.audioEnabled ? 'sample' : 'silent preview'}${detail ? ` · ${detail}` : ''}${score.unsupported?.length ? ` · skipped ${score.unsupported.join(' ')}` : ''}${score.warnings?.length ? ` · ${score.warnings.join(' ')}` : ''}`;
    return score;
  }
  function fail(error) { if (!disposed && error?.name !== 'AbortError') $('mixerSampleStatus').textContent = error.message || 'Could not play this sample.'; }
  function safely(action) { try { const result = action(); result?.catch(fail); } catch (error) { fail(error); } }
  function cancelPending() {
    requestTicket++; request?.abort(); request = null;
    if (loadingSample && !disposed) $('mixerSampleStatus').textContent = 'Stamp loading canceled';
    loadingSample = false; pointer = null;
  }
  function options(transpose = 0) { return { seed, density: Number($('mixerStampDensity').value), span: Number($('mixerStampSpan').value), beats: Number($('mixerStampBeats').value), transpose }; }
  function numberInput(id, min, max, fallback, integer = false) {
    const value = $(id).valueAsNumber, bounded = Number.isFinite(value) ? clamp(value, min, max) : fallback;
    return integer ? Math.round(bounded) : bounded;
  }
  function drawingPitchRange() {
    const maximum = 128 - numberInput('mixerStampSpan', 12, 128, 48, true);
    const input = $('mixerStampDrawBase'); input.max = String(maximum);
    input.value = String(numberInput('mixerStampDrawBase', 0, maximum, Math.min(48, maximum), true));
  }
  function thumbnail(button, score) {
    const previewCanvas = button.querySelector('canvas'), ctx = previewCanvas.getContext('2d');
    ctx.clearRect(0, 0, previewCanvas.width, previewCanvas.height); ctx.fillStyle = '#caa0db';
    if (score.pixels) {
      const height = score.pixels.length, width = score.pixels[0]?.length || 1;
      score.pixels.forEach((row, y) => row.forEach((value, x) => { if (value) ctx.fillRect(x * 96 / width, y * 48 / height, Math.max(1, 96 / width), Math.max(1, 48 / height)); }));
    } else if (score.analysis) {
      for (const note of score.analysis.notes) ctx.fillRect(note.note / 128 * 96, note.beat / score.durationBeats * 48, 1, Math.max(1, note.duration / score.durationBeats * 48));
    }
  }
  function refreshPreviews() {
    previewFrame = null;
    for (const stamp of stamps.values()) if (!stamp.file && !buttons.get(stamp.id).hidden) thumbnail(buttons.get(stamp.id), editScore(mixerStampScore(stamp.id, options())));
  }
  function queuePreviews() { if (previewFrame === null) previewFrame = requestAnimationFrame(refreshPreviews); }
  function filterStamps() {
    const words = $('mixerStampFilter').value.toLocaleLowerCase().trim().split(/\s+/).filter(Boolean); let count = 0;
    for (const stamp of stamps.values()) {
      const match = words.every(word => `${stamp.label} ${stamp.group || ''} ${stamp.artist || ''} ${stamp.file ? 'MIDI file' : 'generated pattern'}`.toLocaleLowerCase().includes(word));
      buttons.get(stamp.id).hidden = !match; count += Number(match);
    }
    $('mixerStampCount').value = `${count} / ${stamps.size}`; queuePreviews();
  }
  function selectAutomata() {
    // Choosing a view changes the next source, never the samples already playing.
    if (!automataSelected) {
      if (stamps.get(selected)?.file) fileProgram = $('mixerSampleProgram').value;
      else patternProgram = $('mixerSampleProgram').value;
    }
    automataSelected = true;
    $('mixerSampleProgram').value = patternProgram;
    for (const button of buttons.values()) button.setAttribute('aria-pressed', 'false');
    for (const name of ['mixerStampDensity', 'mixerStampSpan', 'mixerStampBeats', 'mixerStampSeed', 'mixerStampVariation']) $(name).disabled = true;
    $('mixerStampNextSlice').hidden = true;
    section.querySelector('.mixer-stamp-file-controls').hidden = true;
    $('mixerStampCredit').hidden = true;
    $('mixerStampHint').textContent = 'Drag across the flow to place the selected Automatapoeia rule by pitch.';
    canvas.dataset.stamp = 'automata';
  }
  const automata = mountAutomataMidiControls(automataTools, {
    idPrefix: automataHost ? 'automataMidi' : 'mixerAutomata', actionLabel: automataHost ? 'Play rule' : 'Stamp rule',
    onGenerate: score => {
      if (!active || disposed) return;
      cancelPending();
      selectAutomata();
      return playScore(score, score.text);
    },
  });
  if (automataHost) automataTools.querySelector('.midiphoria-automata').open = true;
  function selectStamp(id) {
    const previous = stamps.get(selected), stamp = stamps.get(id); if (!stamp) return;
    if (previous?.file && !automataSelected) fileProgram = $('mixerSampleProgram').value; else patternProgram = $('mixerSampleProgram').value;
    automataSelected = false; $('mixerStampBeats').disabled = false;
    $('mixerStampHint').textContent = 'Tap a stamp, or drag across the flow to place it by pitch.';
    if (selected !== id) { fileStart = null; lastFileStamp = null; }
    selected = id; $('mixerSampleProgram').value = stamp.file ? fileProgram : patternProgram;
    for (const [key, button] of buttons) button.setAttribute('aria-pressed', String(key === id));
    for (const name of ['mixerStampDensity', 'mixerStampSpan']) $(name).disabled = Boolean(stamp.file);
    $('mixerStampSeed').disabled = Boolean(stamp.file);
    section.querySelector('.mixer-stamp-file-controls').hidden = !stamp.file;
    const mode = $('mixerStampSourceMode').value;
    $('mixerStampStart').disabled = !stamp.file || mode !== 'manual';
    nextVariation = stamp.file ? null : nextMixerStampVariation(id, options());
    $('mixerStampVariation').disabled = !nextVariation;
    $('mixerStampNextSlice').hidden = !stamp.file || mode === 'whole' || mode === 'auto' && stamp.collection === 'Geometric patterns';
    const credit = $('mixerStampCredit'); credit.hidden = !stamp.file;
    if (stamp.file) { credit.href = stamp.sourceUrl || 'assets/midiphoria/SOURCE.md'; credit.textContent = `${stamp.artist || stamp.composer || 'Source'} · file credits ↗`; }
    canvas.dataset.stamp = id;
  }
  async function stampSelected(transpose = 0) {
    if (!active || disposed) return;
    cancelPending();
    if (automataSelected) {
      const settings = automata.getSettings();
      const score = generateAutomataMidi({ ...settings, lowestNote: settings.lowestNote + transpose });
      playScore(score, score.text); return;
    }
    const ticket = requestTicket, stamp = stamps.get(selected); if (!stamp) return;
    if (!stamp.file) { thumbnail(buttons.get(stamp.id), playScore(mixerStampScore(stamp.id, options(transpose)), stamp.label)); return; }
    // Switching creative views can select a different source family while this
    // file loads. Keep the sound chosen for this launch without touching others.
    const program = $('mixerSampleProgram').value;
    loadingSample = true; $('mixerSampleStatus').textContent = `Loading ${stamp.label}…`;
    try {
      let analysis = fileCache.get(stamp.id);
      if (!analysis) {
        request = new AbortController();
        const response = await fetch(new URL(`../../../assets/midiphoria/${stamp.file}`, import.meta.url), { signal: request.signal });
        if (!response.ok) throw new Error(`Could not load this stamp (${response.status}).`);
        const buffer = await response.arrayBuffer(); if (ticket !== requestTicket || !active || disposed) return;
        analysis = parseMidi(buffer); fileCache.set(stamp.id, analysis);
        while (fileCache.size > 2) fileCache.delete(fileCache.keys().next().value);
      }
      if (ticket !== requestTicket || !active || disposed) return;
      const mode = $('mixerStampSourceMode').value, whole = mode === 'whole' || mode === 'auto' && stamp.collection === 'Geometric patterns';
      const start = mode === 'manual' ? Math.max(0, Number($('mixerStampStart').value) || 0) : fileStart;
      const score = createMidiFileStamp(analysis, { beats: options().beats, whole, ...(whole ? { fitBeats: options().beats } : {}), ...(start === null || whole ? {} : { startBeat: start }), transpose, name: stamp.label });
      lastFileStamp = score;
      if (mode === 'manual') $('mixerStampStart').value = String(score.sourceStartBeat);
      const range = `${whole && !score.shortened ? stamp.collection === 'Geometric patterns' ? 'whole pattern' : 'whole file' : 'excerpt'} · source beats ${score.sourceStartBeat.toFixed(1)}–${score.sourceEndBeat.toFixed(1)} · ${score.noteCount.toLocaleString()} notes`;
      thumbnail(buttons.get(stamp.id), playScore(score, stamp.label, `${range}${score.shortened ? ' · shorter dense slice' : ''}`, program));
    } catch (error) { if (ticket === requestTicket) fail(error); }
    finally { if (ticket === requestTicket) { loadingSample = false; request = null; } }
  }
  function addStamp(stamp) {
    if (stamps.has(stamp.id)) return; stamps.set(stamp.id, stamp);
    const button = document.createElement('button'); button.type = 'button'; button.dataset.mixerSample = stamp.id; button.title = `${stamp.label} · ${stamp.group || 'Shape'}`; button.setAttribute('aria-label', stamp.label); button.setAttribute('aria-pressed', String(stamp.id === selected));
    const miniature = document.createElement('canvas'); miniature.width = 96; miniature.height = 48; miniature.setAttribute('aria-hidden', 'true');
    const label = document.createElement('span'); label.textContent = stamp.label;
    const group = document.createElement('small'); group.textContent = stamp.group || 'Shape';
    button.append(miniature, label, group); buttons.set(stamp.id, button);
    if (stamp.file) { const ctx = miniature.getContext('2d'); ctx.fillStyle = '#a8c5bd'; ctx.font = '14px monospace'; ctx.textAlign = 'center'; ctx.fillText('MIDI', 48, 30); }
    on(button, 'click', () => { selectStamp(stamp.id); safely(() => stampSelected()); });
    section.querySelector('.mixer-sample-bank').append(button);
  }
  MIXER_SAMPLE_STAMPS.forEach(addStamp); selectStamp(selected); filterStamps();
  on($('mixerStampFilter'), 'input', filterStamps);
  for (const name of ['mixerStampDensity', 'mixerStampSpan', 'mixerStampBeats']) on($(name), 'input', () => {
    cancelPending(); fileStart = null; lastFileStamp = null;
    $('mixerStampDensityOut').value = `${Math.round(options().density * 100)}%`;
    $('mixerStampSpanOut').value = `${options().span} notes`; $('mixerStampBeatsOut').value = `${options().beats} beats`; drawingPitchRange(); selectStamp(selected); queuePreviews();
  });
  on($('mixerStampAgain'), 'click', () => safely(() => stampSelected()));
  on($('mixerStampVariation'), 'click', () => { if (!nextVariation) return; seed = nextVariation.patternOptions.seed; $('mixerStampSeed').value = String(seed); selectStamp(selected); queuePreviews(); safely(() => stampSelected()); });
  on($('mixerStampNextSlice'), 'click', () => {
    fileStart = lastFileStamp?.nextStartBeat ?? null;
    if ($('mixerStampSourceMode').value === 'manual') $('mixerStampStart').value = String(fileStart ?? 0);
    safely(() => stampSelected());
  });
  on($('mixerStampSeed'), 'input', () => { cancelPending(); seed = numberInput('mixerStampSeed', 0, 0xffffffff, 1, true); selectStamp(selected); queuePreviews(); });
  on($('mixerStampGate'), 'input', () => {
    cancelPending(); $('mixerStampGateOut').value = `${Math.round(Number($('mixerStampGate').value) * 100)}%`; queuePreviews();
    if (lastFileStamp && stamps.get(selected)?.file) safely(() => thumbnail(buttons.get(selected), editScore(lastFileStamp)));
  });
  on($('mixerStampSourceMode'), 'change', () => { cancelPending(); fileStart = null; lastFileStamp = null; selectStamp(selected); });
  on($('mixerStampStart'), 'input', () => { cancelPending(); fileStart = null; lastFileStamp = null; });
  on($('mixerStampResetSource'), 'click', () => {
    cancelPending(); seed = 1; fileStart = null; lastFileStamp = null;
    const defaults = { mixerStampDensity: '.5', mixerStampSpan: '48', mixerStampBeats: '8', mixerStampSeed: '1', mixerStampGate: '1', mixerStampSourceMode: 'auto', mixerStampStart: '0', mixerStampTextMode: 'word', mixerStampDrawRow: '.25', mixerStampDrawBase: '48' };
    for (const [id, value] of Object.entries(defaults)) $(id).value = value;
    $('mixerStampDensityOut').value = '50%'; $('mixerStampSpanOut').value = '48 notes'; $('mixerStampBeatsOut').value = '8 beats'; $('mixerStampGateOut').value = '100%';
    drawingPitchRange(); selectStamp(selected); queuePreviews(); $('mixerSampleStatus').textContent = 'Source settings reset';
  });
  on($('mixerSampleProgram'), 'change', () => {
    const value = $('mixerSampleProgram').value;
    if (stamps.get(selected)?.file && !automataSelected) fileProgram = value; else patternProgram = value;
    engine.configureSamples({ midi: { program: value === 'original' ? null : Number(value) } }); midiEditor.refresh();
  });
  on($('mixerSampleLevel'), 'input', () => {
    const gain = Number($('mixerSampleLevel').value); $('mixerSampleLevelOut').value = `${Math.round(gain * 100)}%`;
    engine.configureSamples({ gain });
  });
  for (const [id, key] of [['mixerSampleLoop', 'loop'], ['mixerSampleSync', 'sync']]) {
    on($(id), 'change', () => engine.configureSamples({ [key]: $(id).checked }));
  }
  function paint(event) {
    const rect = canvas.getBoundingClientRect(), pitch = (event.clientX - rect.left) / rect.width * 128;
    const settings = automataSelected ? automata.getSettings() : null;
    const transpose = settings
      ? Math.round(pitch - settings.columns / 2) - settings.lowestNote
      : Math.round(clamp(pitch - 72, stamps.get(selected)?.file ? -36 : -127, stamps.get(selected)?.file ? 36 : 127));
    safely(() => stampSelected(transpose));
  }
  on(canvas, 'pointerdown', event => {
    if (viewMode === 'mixer' || !active || !$('mixerStampPaint').checked || !event.isPrimary || event.button !== 0) return;
    event.preventDefault(); canvas.setPointerCapture(event.pointerId); paint(event);
    pointer = { id: event.pointerId, x: event.clientX, at: clock() };
  });
  on(canvas, 'pointermove', event => {
    if (viewMode === 'mixer' || !active || pointer?.id !== event.pointerId || Math.abs(event.clientX - pointer.x) < 12 || clock() - pointer.at < Math.max(.12, 30 / engine.state.tempo)) return;
    paint(event); pointer = { id: event.pointerId, x: event.clientX, at: clock() };
  });
  for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) on(canvas, type, () => { pointer = null; });
  on(canvas, 'keydown', event => { if (viewMode !== 'mixer' && active && event.key === 'Enter') { event.preventDefault(); safely(() => stampSelected()); } });
  const paintMode = () => {
    const painting = viewMode !== 'mixer' && $('mixerStampPaint').checked;
    canvas.style.touchAction = painting ? 'none' : 'pan-y'; canvas.classList.toggle('mixer-painting', painting);
  };
  on($('mixerStampPaint'), 'change', paintMode); paintMode();
  on(section.querySelector('.mixer-sample-message'), 'submit', event => {
    event.preventDefault(); cancelPending(); safely(() => { const score = mixerMessageScore($('mixerSampleMessage').value, { mode: $('mixerStampTextMode').value }); playScore(score, score.text); });
  });
  function playDrawing() {
    if (disposed) return null;
    cancelPending(); drawingPitchRange();
    return playScore(mixerPerformanceScore(getDrawing?.(), {
      secondsPerRow: numberInput('mixerStampDrawRow', .125, 1, .25) / 2,
      span: numberInput('mixerStampSpan', 12, 128, 48, true),
      lowestNote: Number($('mixerStampDrawBase').value),
    }), 'Your drawing');
  }
  function stopSamples() {
    if (disposed) return;
    cancelPending(); engine.stopSamples(); $('mixerSampleStatus').textContent = 'Samples stopped';
  }
  on(drawingButton ?? $('mixerSendDrawing'), 'click', () => safely(playDrawing));
  on($('mixerStopSamples'), 'click', stopSamples);
  on($('mixerPerformanceView'), 'change', () => renderer.configure({ view: $('mixerPerformanceView').value }));
  const stampOnly = [section.querySelector('.mixer-stamp-palette'), section.querySelector('.mixer-stamp-shape-controls'),
    section.querySelector('.mixer-sample-message'), ...['mixerStampSeed', 'mixerStampTextMode', 'mixerStampDrawRow', 'mixerStampDrawBase'].map(id => $(id).closest('label')),
    $('mixerStampResetSource')];
  return {
    cancelPending, playDrawing, stopSamples,
    setView(mode, nextVisualizerHost) {
      if (disposed) return;
      const next = ['draw', 'automata', 'mixer'].includes(mode) ? mode : 'mixer';
      if (nextVisualizerHost && visualizer.parentElement !== nextVisualizerHost) nextVisualizerHost.append(visualizer);
      if (next !== viewMode) {
        pointer = null;
        if (next === 'automata') selectAutomata();
        else if (next === 'draw' && automataSelected) selectStamp(selected);
      }
      viewMode = next; section.dataset.view = next; visualizer.dataset.view = next;
      for (const node of stampOnly) node.hidden = next === 'automata';
      $('mixerSendDrawing').hidden = !internalDrawing || next === 'automata';
      if (next === 'mixer') { canvas.removeAttribute('tabindex'); canvas.removeAttribute('aria-describedby'); }
      else { canvas.tabIndex = 0; canvas.setAttribute('aria-describedby', 'mixerStampHint'); }
      paintMode(); if (active) renderer.resize();
    },
    setCollection(collection) {
      for (const song of collection) if (song.file && /black midi|geometric/i.test(song.collection || '')) addStamp({ ...song, label: song.title, group: song.collection });
      filterStamps();
    },
    setActive(value) {
      const next = Boolean(value) && !disposed;
      if (active === next) return;
      active = next;
      monitor.setActive(active);
      if (!active) { cancelPending(); return; }
      midiEditor.refresh();
    },
    dispose() { if (disposed) return; disposed = true; active = false; cancelPending(); fileCache.clear(); if (previewFrame !== null) cancelAnimationFrame(previewFrame); monitor.dispose(); engine.stopSamples(); automata.dispose(); midiEditor.destroy(); events.abort(); visualizer.remove(); volume.remove(); automataTools.remove(); section.remove(); },
  };
}

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
export function mountMixerPerformance(host, { engine, getDrawing, visualizerHost, volumeHost, automataHost, drawingButton, padsHost, liveAutomata = false, shapeHost, messageHost, onEditDrawing, showVisualizer = true, orientation = 'rising' } = {}) {
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
    <label>Width → <output id="mixerStampSpanOut">48 notes</output><input id="mixerStampSpan" aria-label="Pattern width in notes" type="range" min="12" max="128" step="1" value="48" /></label>
    <label>Height ↑ <output id="mixerStampBeatsOut">8 beats</output><input id="mixerStampBeats" aria-label="Pattern height in beats" type="range" min=".25" max="64" step=".25" value="8" /></label>
    <label class="mixer-stamp-offset">Offset ↔ <output id="mixerStampOffsetOut">0 notes</output><input id="mixerStampOffset" aria-label="Pattern horizontal offset in notes" data-keep-slider type="range" min="-127" max="127" step="1" value="0" /></label>
    <div class="mixer-stamp-actions"><button id="mixerStampAgain" type="button">Stamp again</button><button id="mixerStampVariation" type="button">Variation</button><button id="mixerStampNextSlice" type="button" hidden>Next slice</button></div>
    <label class="mixer-stamp-paint"><input id="mixerStampPaint" type="checkbox" checked />Paint flow</label>
    <span id="mixerStampHint">Tap a stamp, or drag across the flow to place it by pitch.</span>
  </div>
  <div class="mixer-stamp-switches" role="group" aria-label="Stamp playback">
    <label title="Looping pads: tap to start, tap again to stop. Turn Loop off for one shots and to finish running loops."><input id="mixerSampleLoop" type="checkbox" />Loop</label>
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
        <label>File window <select id="mixerStampSourceMode"><option value="auto">Default window</option><option value="dense">Densest slice</option><option value="manual">Choose start</option><option value="whole">Whole file, fit to Height</option></select></label>
        <label>Start beat <input id="mixerStampStart" type="number" min="0" max="4000000" step=".25" value="0" disabled /></label>
      </div>
      <label>Message layout <select id="mixerStampTextMode"><option value="word">Whole words</option><option value="letter">One letter at a time</option></select></label>
      <label>Drawing row length <input id="mixerStampDrawRow" type="number" min=".0078125" max="2" step=".0078125" value=".25" /> beats</label>
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
  if (showVisualizer) { if (visualizerHost) visualizerHost.append(visualizer); else section.prepend(visualizer); }
  const volume = $('mixerSampleLevel').closest('label');
  if (volumeHost) volumeHost.append(volume);
  if (automataHost) automataHost.append(automataTools);
  const savedPads = document.createElement('section'); savedPads.id = 'mixerSavedPads'; savedPads.className = 'mixer-saved-pads'; savedPads.hidden = true;
  savedPads.innerHTML = '<div class="mixer-stamp-bank-heading"><span>Your pads</span><small>Tap to play / stop · last 8 sends</small></div><div class="mixer-saved-bank" role="group" aria-label="Sent drawing, message and rule pads"></div>';
  (padsHost ?? section).append(savedPads);
  const palette = section.querySelector('.mixer-stamp-palette'), bank = palette.querySelector('.mixer-sample-bank');
  if (liveAutomata && padsHost) {
    padsHost.append(palette); bank.prepend(savedPads);
    palette.querySelector('.mixer-stamp-bank-heading > span').textContent = 'Playable pads';
    savedPads.classList.add('mixer-saved-pads-inline');
    savedPads.querySelector('.mixer-stamp-bank-heading').hidden = true;
    $('mixerSampleSync').checked = true; $('mixerSampleSync').closest('label').hidden = true;
    $('mixerSampleLoop').closest('label').lastChild.textContent = 'Loop drawing';
    $('mixerSampleLoop').closest('label').title = 'Loop the next drawing you send. Other pads keep their own Loop settings.';
  }
  const shapeControls = section.querySelector('.mixer-stamp-shape-controls'), messageForm = section.querySelector('.mixer-sample-message');
  if (shapeHost) shapeHost.append(shapeControls);
  if (messageHost === false) {
    // A dedicated text preparation tool can replace this legacy message form.
    messageForm.remove(); $('mixerStampTextMode').closest('label').remove();
  } else if (messageHost) messageHost.append(messageForm);
  const events = new AbortController();
  const on = (node, type, listener) => node.addEventListener(type, listener, { signal: events.signal });
  let active = false, disposed = false;
  function refresh(state = engine.state) {
    $('mixerStopSamples').disabled = !(state.samples?.length) && !loadingSample;
    reflectPads(state); if (liveAutomata) automata.refreshLive(state.automata);
  }
  const monitor = showVisualizer ? mountMidiPerformanceMonitor(canvas, { engine, onFrame: refresh }) : null;
  const renderer = monitor?.renderer ?? { configure() {}, resize() {} };
  if (!showVisualizer) {
    $('mixerStampPaint').closest('label').remove();
    $('mixerStampHint').textContent = 'Tap a pad to drop it. Looping pads toggle on and off.';
  }
  const stamps = new Map(), buttons = new Map(), stampCards = new Map(), fileCache = new Map(), padSamples = new Map(), saved = new Map();
  let savedSerial = 0, drawingSerial = 0, pendingPad = null;
  let automataSelected = false, viewMode = 'draw';
  let selected = 'heart', seed = 1, request = null, requestTicket = 0, editRequest = null, editTicket = 0, loadingSample = false, previewFrame = null;
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
  function padState(button, sample, pending = false, loop = $('mixerSampleLoop').checked) {
    const set = (name, value) => { if (button.getAttribute(name) !== value) button.setAttribute(name, value); };
    set('aria-pressed', String(Boolean(sample))); set('aria-busy', String(pending));
    if (button.dataset.pending !== String(pending)) button.dataset.pending = String(pending);
    const status = button.querySelector('[data-pad-state]');
    const text = pending ? 'Loading · tap to cancel' : sample?.paused ? 'Paused · tap to resume' : sample ? sample.loop ? 'Looping · tap to stop' : 'Playing · tap to retrigger' : loop ? 'Loop · tap to start' : 'One shot';
    if (status && status.textContent !== text) status.textContent = text;
  }
  function reflectPads(state = engine.state) {
    const playing = new Map(state.samples.map(sample => [sample.id, sample]));
    for (const [key, id] of padSamples) if (!playing.has(id)) padSamples.delete(key);
    for (const [key, button] of buttons) {
      const sample = playing.get(padSamples.get(key));
      padState(button, sample, loadingSample && pendingPad === key, liveAutomata ? stamps.get(key).loop : $('mixerSampleLoop').checked);
      const card = stampCards.get(key);
      if (sample && card) { stamps.get(key).loop = sample.loop; card.querySelector('[data-stamp-loop]').checked = sample.loop; }
      if (card) { card.dataset.playing = String(Boolean(sample)); card.hidden = !sample && button.dataset.filtered === 'true'; }
    }
    for (const record of saved.values()) {
      const sample = playing.get(padSamples.get(record.id));
      if (sample) record.loop = sample.loop;
      record.card.dataset.playing = String(Boolean(sample));
      record.card.hidden = !sample && record.button.dataset.filtered === 'true';
      record.loopInput.checked = record.loop;
      padState(record.button, sample);
      const status = record.button.querySelector('[data-pad-state]');
      if (!sample) status.textContent = record.loop ? 'Loop · tap to start' : 'One shot';
    }
  }
  function launchScore(score, label, program, padId, loop = $('mixerSampleLoop').checked) {
    const previous = padSamples.get(padId);
    if (previous !== undefined) engine.stopSample(previous);
    const sample = engine.triggerSample(score.buffer, { name: liveAutomata && stamps.has(padId) ? `Stamp · ${label}` : label, program: null, gain: Number($('mixerSampleLevel').value),
      loop, sync: liveAutomata || $('mixerSampleSync').checked,
      midi: { ...(engine.state.sampleMidi ?? {}), program: program === 'original' ? null : Number(program) } });
    if (sample && padId) padSamples.set(padId, sample.id);
    reflectPads(); return sample;
  }
  function forgetPad(record) {
    const id = padSamples.get(record.id); if (id !== undefined) engine.stopSample(id);
    padSamples.delete(record.id); saved.delete(record.id); record.events.abort(); record.card.remove();
    savedPads.hidden = !saved.size;
  }
  function saveScore(score, label, program, kind, loop = $('mixerSampleLoop').checked) {
    // Keep a bounded bank of immutable sends; playing audio retains its own copy.
    if (saved.size >= 8) {
      const activeIds = new Set(engine.state.samples.map(sample => sample.id));
      const oldest = [...saved.values()].find(record => !activeIds.has(padSamples.get(record.id))) ?? saved.values().next().value;
      forgetPad(oldest);
    }
    const id = kind === 'drawing' ? `drawing-${++drawingSerial}` : `${kind}-${++savedSerial}`;
    if (kind === 'drawing') label = `Drawing ${drawingSerial}`;
    const card = document.createElement('div'); card.className = 'mixer-saved-pad'; card.dataset.savedPad = id;
    card.innerHTML = '<button type="button" data-pad-play aria-pressed="false"><canvas width="96" height="48" aria-hidden="true"></canvas><span data-pad-name></span><small data-pad-state></small></button><div class="mixer-saved-pad-actions"><label><input type="checkbox" data-pad-loop>Loop</label><button type="button" data-pad-edit>Edit</button><button type="button" data-pad-remove>×</button></div>';
    const button = card.querySelector('[data-pad-play]'), loopInput = card.querySelector('[data-pad-loop]');
    button.querySelector('[data-pad-name]').textContent = label; button.setAttribute('aria-label', label);
    loopInput.setAttribute('aria-label', `Loop ${label}`); card.querySelector('[data-pad-remove]').setAttribute('aria-label', `Remove ${label}`);
    const record = { id, card, button, loopInput, score, label, program, events: new AbortController(), loop };
    const listen = (node, type, listener) => node.addEventListener(type, listener, { signal: record.events.signal });
    listen(button, 'click', () => safely(() => {
      const sample = engine.state.samples.find(sample => sample.id === padSamples.get(id));
      if (sample?.paused) { engine.setSamplePaused(sample.id, false); reflectPads(); return; }
      if (sample?.loop) { engine.stopSample(sample.id); reflectPads(); return; }
      launchScore(record.score, record.label, record.program, id, record.loop);
    }));
    listen(loopInput, 'change', () => {
      record.loop = loopInput.checked; const sampleId = padSamples.get(id);
      if (sampleId !== undefined) engine.configureSample(sampleId, { loop: record.loop });
      reflectPads();
    });
    listen(card.querySelector('[data-pad-remove]'), 'click', () => { forgetPad(record); reflectPads(); });
    const edit = card.querySelector('[data-pad-edit]'); edit.hidden = !onEditDrawing;
    edit.setAttribute('aria-label', `Edit ${label}`);
    listen(edit, 'click', () => { cancelEdit(); onEditDrawing?.(record.score, record.label); });
    saved.set(id, record); savedPads.querySelector('.mixer-saved-bank').append(card); savedPads.hidden = false;
    thumbnail(button, score); filterStamps(); return record;
  }
  function playScore(rawScore, label, detail = '', program = $('mixerSampleProgram').value, { padId = null, saveKind = null, loop = $('mixerSampleLoop').checked, applyGate = true } = {}) {
    const score = applyGate ? editScore(rawScore) : rawScore;
    if (!score?.buffer) throw new Error('Draw a score first in BLECH MIDI.');
    const record = saveKind ? saveScore(score, label, program, saveKind, loop) : null;
    launchScore(score, record?.label ?? label, program, record?.id ?? padId, loop);
    canvas.dataset.message = label;
    $('mixerSampleStatus').textContent = `${label} · ${engine.state.audioEnabled ? 'sample' : 'silent preview'}${detail ? ` · ${detail}` : ''}${score.unsupported?.length ? ` · skipped ${score.unsupported.join(' ')}` : ''}${score.warnings?.length ? ` · ${score.warnings.join(' ')}` : ''}`;
    return score;
  }
  function fail(error) { if (!disposed && error?.name !== 'AbortError') $('mixerSampleStatus').textContent = error.message || 'Could not play this sample.'; }
  function safely(action) { try { const result = action(); result?.catch(fail); } catch (error) { fail(error); } }
  function cancelPending() {
    requestTicket++; request?.abort(); request = null;
    if (loadingSample && !disposed) $('mixerSampleStatus').textContent = 'Stamp loading canceled';
    loadingSample = false; pendingPad = null; pointer = null; reflectPads();
  }
  function cancelEdit() { editTicket++; editRequest?.abort(); editRequest = null; }
  function options(transpose = 0) { return { orientation, seed, density: Number($('mixerStampDensity').value), span: Number($('mixerStampSpan').value), beats: Number($('mixerStampBeats').value), offset: Number($('mixerStampOffset').value), transpose }; }
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
      const height = score.pixels.length;
      score.pixels.forEach((row, y) => row.forEach((value, x) => { if (value) ctx.fillRect(((score.lowestNote ?? 0) + x) * 96 / 128, y * 48 / height, Math.max(1, 96 / 128), Math.max(1, 48 / height)); }));
    } else if (score.analysis) {
      for (const note of score.analysis.notes) ctx.fillRect(note.note / 128 * 96, (orientation === 'falling' ? 1 - (note.beat + note.duration) / score.durationBeats : note.beat / score.durationBeats) * 48, 1, Math.max(1, note.duration / score.durationBeats * 48));
    }
  }
  function refreshPreviews() {
    previewFrame = null;
    for (const stamp of stamps.values()) if (!stamp.file && !(stampCards.get(stamp.id) ?? buttons.get(stamp.id)).hidden) {
      const score = mixerStampScore(stamp.id, options());
      thumbnail(buttons.get(stamp.id), editScore(score));
      if (stamp.id === selected && !automataSelected) {
        const offset = score.appliedOffset;
        $('mixerStampOffsetOut').value = `${offset > 0 ? '+' : ''}${offset} notes${offset !== options().offset ? ' · edge' : ''}`;
      }
    }
  }
  function queuePreviews() { if (previewFrame === null) previewFrame = requestAnimationFrame(refreshPreviews); }
  function filterStamps() {
    const words = $('mixerStampFilter').value.toLocaleLowerCase().trim().split(/\s+/).filter(Boolean); let count = 0;
    for (const stamp of stamps.values()) {
      const match = words.every(word => `${stamp.label} ${stamp.group || ''} ${stamp.artist || ''} ${stamp.file ? 'MIDI file' : 'generated pattern'}`.toLocaleLowerCase().includes(word));
      const button = buttons.get(stamp.id); button.dataset.filtered = String(!match);
      if (!liveAutomata) button.hidden = !match;
      count += Number(match);
    }
    for (const record of saved.values()) {
      const match = words.every(word => `${record.label} saved drawing capture`.toLocaleLowerCase().includes(word));
      record.button.dataset.filtered = String(!match); count += Number(match);
    }
    $('mixerStampCount').value = `${count} / ${stamps.size + saved.size}`; reflectPads(); queuePreviews();
  }
  function selectAutomata() {
    // Choosing a view changes the next source, never the samples already playing.
    if (!automataSelected) {
      if (stamps.get(selected)?.file) fileProgram = $('mixerSampleProgram').value;
      else patternProgram = $('mixerSampleProgram').value;
    }
    automataSelected = true;
    $('mixerSampleProgram').value = patternProgram;
    for (const button of buttons.values()) button.dataset.selected = 'false';
    for (const name of ['mixerStampDensity', 'mixerStampSpan', 'mixerStampBeats', 'mixerStampSeed', 'mixerStampVariation']) $(name).disabled = true;
    $('mixerStampNextSlice').hidden = true;
    section.querySelector('.mixer-stamp-file-controls').hidden = true;
    $('mixerStampCredit').hidden = true;
    $('mixerStampHint').textContent = 'Drag across the flow to place the selected Automatapoeia rule by pitch.';
    canvas.dataset.stamp = 'automata';
  }
  const automata = mountAutomataMidiControls(automataTools, {
    idPrefix: automataHost ? 'automataMidi' : 'mixerAutomata', actionLabel: automataHost ? 'Play rule' : 'Stamp rule',
    live: liveAutomata,
    onChange: settings => engine.configureAutomata(settings),
    onPlayPause: () => engine.setAutomataPlaying(!engine.state.automata.playing),
    onRestart: () => engine.restartAutomata(),
    onCapture: async beats => {
      const score = await engine.captureAutomata(beats);
      if (disposed) return null;
      saveScore(score, `Evolution ${++savedSerial} · ${Number(score.durationBeats.toFixed(2))} beats`, 'original', 'capture', true);
      reflectPads(); $('mixerSampleStatus').textContent = 'Evolution captured · tap its pad to play';
      return score;
    },
    onGenerate: score => {
      if (!active || disposed) return;
      cancelPending();
      selectAutomata();
      return playScore(score, score.text, '', $('mixerSampleProgram').value, { saveKind: 'rule' });
    },
  });
  if (liveAutomata) engine.configureAutomata(automata.getSettings());
  if (automataHost) automataTools.querySelector('.midiphoria-automata').open = true;
  function selectStamp(id) {
    const previous = stamps.get(selected), stamp = stamps.get(id); if (!stamp) return;
    if (previous?.file && !automataSelected) fileProgram = $('mixerSampleProgram').value; else patternProgram = $('mixerSampleProgram').value;
    automataSelected = false; $('mixerStampBeats').disabled = false;
    $('mixerStampHint').textContent = 'Loop on: tap to start / stop. Loop off: one shot. Drag on the flow to place copies.';
    if (selected !== id) { fileStart = null; lastFileStamp = null; }
    selected = id; $('mixerSampleProgram').value = stamp.file ? fileProgram : patternProgram;
    for (const [key, button] of buttons) button.dataset.selected = String(key === id);
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
  async function stampSelected(transpose = 0, padId = selected) {
    if (!active || disposed) return;
    cancelPending();
    if (automataSelected) {
      const settings = automata.getSettings();
      const score = generateAutomataMidi({ ...settings, lowestNote: settings.lowestNote + transpose + options().offset });
      playScore(score, score.text, '', $('mixerSampleProgram').value, { saveKind: 'rule' }); return;
    }
    const ticket = requestTicket, stamp = stamps.get(selected); if (!stamp) return;
    const pad = { padId, saveKind: padId ? null : 'flow', loop: liveAutomata ? stamp.loop : $('mixerSampleLoop').checked };
    if (!stamp.file) { thumbnail(buttons.get(stamp.id), playScore(mixerStampScore(stamp.id, options(transpose)), stamp.label, '', $('mixerSampleProgram').value, pad)); return; }
    // Switching creative views can select a different source family while this
    // file loads. Keep the sound chosen for this launch without touching others.
    const program = $('mixerSampleProgram').value;
    loadingSample = true; pendingPad = stamp.id; reflectPads(); $('mixerSampleStatus').textContent = `Loading ${stamp.label}…`;
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
      const score = createMidiFileStamp(analysis, { beats: options().beats, whole, fitBeats: options().beats, ...(start === null || whole ? {} : { startBeat: start }), transpose: transpose + options().offset, name: stamp.label });
      lastFileStamp = score;
      if (mode === 'manual') $('mixerStampStart').value = String(score.sourceStartBeat);
      const range = `${whole && !score.shortened ? stamp.collection === 'Geometric patterns' ? 'whole pattern' : 'whole file' : 'excerpt'} · source beats ${score.sourceStartBeat.toFixed(1)}–${score.sourceEndBeat.toFixed(1)} · ${score.noteCount.toLocaleString()} notes`;
      if (liveAutomata) pad.loop = stamp.loop;
      thumbnail(buttons.get(stamp.id), playScore(score, stamp.label, `${range}${score.shortened ? ' · shorter dense slice' : ''}`, program, pad));
    } catch (error) { if (ticket === requestTicket) fail(error); }
    finally { if (ticket === requestTicket) { loadingSample = false; pendingPad = null; request = null; reflectPads(); } }
  }
  function triggerPad(id) {
    if (!active || disposed) return;
    if (loadingSample && pendingPad === id) { cancelPending(); return; }
    const sample = engine.state.samples.find(sample => sample.id === padSamples.get(id));
    selectStamp(id);
    if (sample?.paused) { engine.setSamplePaused(sample.id, false); reflectPads(); return; }
    if (sample?.loop) { engine.stopSample(sample.id); reflectPads(); return; }
    safely(() => stampSelected(0, id));
  }
  function addStamp(stamp) {
    if (stamps.has(stamp.id)) return; stamp = { ...stamp, loop: false }; stamps.set(stamp.id, stamp);
    const button = document.createElement('button'); button.type = 'button'; button.dataset.mixerSample = stamp.id; button.title = `${stamp.label} · ${stamp.group || 'Shape'}`; button.setAttribute('aria-label', stamp.label); button.setAttribute('aria-pressed', 'false'); button.dataset.selected = String(stamp.id === selected);
    const miniature = document.createElement('canvas'); miniature.width = 96; miniature.height = 48; miniature.setAttribute('aria-hidden', 'true');
    const label = document.createElement('span'); label.textContent = stamp.label;
    const group = document.createElement('small'); group.textContent = stamp.group || 'Shape';
    const status = document.createElement('small'); status.dataset.padState = ''; status.textContent = 'One shot';
    button.append(miniature, label, group, status); buttons.set(stamp.id, button);
    if (stamp.file) { const ctx = miniature.getContext('2d'); ctx.fillStyle = '#a8c5bd'; ctx.font = '14px monospace'; ctx.textAlign = 'center'; ctx.fillText('MIDI', 48, 30); }
    on(button, 'click', () => triggerPad(stamp.id));
    if (liveAutomata) {
      const card = document.createElement('div'); card.className = 'mixer-saved-pad mixer-stamp-pad'; card.dataset.stampPad = stamp.id;
      const actions = document.createElement('div'); actions.className = 'mixer-saved-pad-actions';
      const loopLabel = document.createElement('label'), loop = document.createElement('input'); loop.type = 'checkbox'; loop.dataset.stampLoop = stamp.id; loop.setAttribute('aria-label', `Loop ${stamp.label}`);
      loopLabel.append(loop, 'Loop'); actions.append(loopLabel);
      on(loop, 'change', () => { stamp.loop = loop.checked; const id = padSamples.get(stamp.id); if (id !== undefined) engine.configureSample(id, { loop: stamp.loop }); reflectPads(); });
      const edit = document.createElement('button'); edit.type = 'button'; edit.textContent = 'Edit'; edit.dataset.stampEdit = stamp.id; edit.setAttribute('aria-label', `Edit ${stamp.label}`); actions.append(edit);
      on(edit, 'click', () => { selectStamp(stamp.id); cancelEdit(); editRequest = new AbortController(); const ticket = editTicket;
        const geometry = options(), mode = $('mixerStampSourceMode').value;
        const start = mode === 'manual' ? Number($('mixerStampStart').value) || 0 : fileStart;
        const whole = mode === 'whole' || mode === 'auto' && stamp.collection === 'Geometric patterns';
        safely(async () => {
        if (!stamp.file) { onEditDrawing?.(mixerStampScore(stamp.id, geometry), stamp.label); return; }
        let analysis = fileCache.get(stamp.id);
        if (!analysis) { const response = await fetch(new URL(`../../../assets/midiphoria/${stamp.file}`, import.meta.url), { signal: editRequest.signal }); if (!response.ok) throw new Error('Could not open this MIDI shape.'); analysis = parseMidi(await response.arrayBuffer()); }
        if (disposed || ticket !== editTicket) return;
        onEditDrawing?.(createMidiFileStamp(analysis, { beats: geometry.beats, whole, fitBeats: geometry.beats, transpose: geometry.offset, ...(start === null || whole ? {} : { startBeat: start }), name: stamp.label }), stamp.label);
      }); });
      card.append(button, actions); stampCards.set(stamp.id, card); bank.append(card);
    } else bank.append(button);
  }
  MIXER_SAMPLE_STAMPS.forEach(addStamp); selectStamp(selected); filterStamps();
  on($('mixerStampFilter'), 'input', filterStamps);
  for (const name of ['mixerStampDensity', 'mixerStampSpan', 'mixerStampBeats', 'mixerStampOffset']) on($(name), 'input', () => {
    cancelPending(); fileStart = null; lastFileStamp = null;
    $('mixerStampDensityOut').value = `${Math.round(options().density * 100)}%`;
    $('mixerStampSpanOut').value = `${options().span} notes`; $('mixerStampBeatsOut').value = `${options().beats} beats`;
    $('mixerStampOffsetOut').value = `${options().offset > 0 ? '+' : ''}${options().offset} notes`;
    if (name === 'mixerStampBeats') $('mixerStampDrawRow').value = String(options().beats / 32);
    drawingPitchRange(); if (!automataSelected) selectStamp(selected); queuePreviews();
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
    const defaults = { mixerStampDensity: '.5', mixerStampSpan: '48', mixerStampBeats: '8', mixerStampOffset: '0', mixerStampSeed: '1', mixerStampGate: '1', mixerStampSourceMode: 'auto', mixerStampStart: '0', mixerStampTextMode: 'word', mixerStampDrawRow: '.25', mixerStampDrawBase: '48' };
    for (const [id, value] of Object.entries(defaults)) $(id).value = value;
    $('mixerStampDensityOut').value = '50%'; $('mixerStampSpanOut').value = '48 notes'; $('mixerStampBeatsOut').value = '8 beats'; $('mixerStampOffsetOut').value = '0 notes'; $('mixerStampGateOut').value = '100%';
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
    on($(id), 'change', () => {
      if (liveAutomata) { if (key === 'sync') $(id).checked = true; reflectPads(); return; }
      if (key === 'loop') for (const record of saved.values()) record.loop = $(id).checked;
      engine.configureSamples({ [key]: $(id).checked }); reflectPads();
    });
  }
  function paint(event) {
    const rect = canvas.getBoundingClientRect(), pitch = (event.clientX - rect.left) / rect.width * 128;
    const settings = automataSelected ? automata.getSettings() : null;
    const transpose = settings
      ? Math.round(pitch - settings.columns / 2) - settings.lowestNote
      : Math.round(clamp(pitch - 72, stamps.get(selected)?.file ? -36 : -127, stamps.get(selected)?.file ? 36 : 127));
    safely(() => stampSelected(transpose, null));
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
  on(canvas, 'keydown', event => { if (viewMode !== 'mixer' && active && event.key === 'Enter') { event.preventDefault(); if (automataSelected) safely(() => stampSelected()); else triggerPad(selected); } });
  const paintMode = () => {
    const painting = viewMode !== 'mixer' && $('mixerStampPaint').checked;
    canvas.style.touchAction = painting ? 'none' : 'pan-y'; canvas.classList.toggle('mixer-painting', painting);
  };
  on($('mixerStampPaint'), 'change', paintMode); paintMode();
  on(messageForm, 'submit', event => {
    event.preventDefault(); cancelPending(); safely(() => { const score = mixerMessageScore($('mixerSampleMessage').value, { ...(orientation === 'falling' ? options() : {}), mode: $('mixerStampTextMode').value }); playScore(score, score.text, '', $('mixerSampleProgram').value, { saveKind: 'message' }); });
  });
  on($('mixerStampDrawRow'), 'input', () => {
    $('mixerStampBeats').value = String(numberInput('mixerStampDrawRow', .0078125, 2, .25) * 32);
    $('mixerStampBeats').dispatchEvent(new Event('input', { bubbles: true }));
  });
  function getDrawingScore() {
    drawingPitchRange();
    return mixerPerformanceScore(getDrawing?.(), {
      orientation, heightBeats: options().beats, offset: options().offset,
      span: numberInput('mixerStampSpan', 12, 128, 48, true),
      lowestNote: Number($('mixerStampDrawBase').value),
    });
  }
  function playDrawing() {
    if (disposed) return null;
    cancelPending();
    return playScore(getDrawingScore(), 'Your drawing', '', $('mixerSampleProgram').value, { saveKind: 'drawing' });
  }
  function sendScore(score, { name = 'MIDI artwork', program = 'original', loop = false } = {}) {
    if (disposed) return null;
    if (!(score?.buffer instanceof ArrayBuffer)) throw new Error('Prepare MIDI artwork before sending it.');
    // The creator already applies its note curves. Store a separate snapshot so
    // later edits and the drawing pad's gate control cannot change this send.
    const snapshot = structuredClone(score);
    cancelPending();
    return playScore(snapshot, String(name).slice(0, 128), '', program,
      { saveKind: 'art', loop: Boolean(loop), applyGate: false });
  }
  function stopSamples() {
    if (disposed) return;
    cancelPending(); engine.stopSamples(); reflectPads(); $('mixerSampleStatus').textContent = 'Samples stopped';
  }
  on(drawingButton ?? $('mixerSendDrawing'), 'click', () => safely(playDrawing));
  on($('mixerStopSamples'), 'click', stopSamples);
  on($('mixerPerformanceView'), 'change', () => renderer.configure({ view: $('mixerPerformanceView').value }));
  const stampOnly = [palette, shapeControls,
    messageForm, ...['mixerStampSeed', 'mixerStampTextMode', 'mixerStampDrawRow', 'mixerStampDrawBase'].map(id => $(id).closest('label')),
    $('mixerStampResetSource')];
  return {
    cancelPending, cancelEdit, playDrawing, sendScore, stopSamples, getDrawingScore, refresh,
    setAutomataSeed: row => automata.setSeedRow(row),
    setView(mode, nextVisualizerHost) {
      if (disposed) return;
      const next = ['draw', 'automata', 'mixer'].includes(mode) ? mode : 'mixer';
      if (showVisualizer && nextVisualizerHost && visualizer.parentElement !== nextVisualizerHost) nextVisualizerHost.append(visualizer);
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
      for (const song of collection) if (song.file && !song.visualOnly && !song.compression && /black midi|geometric/i.test(song.collection || '')) addStamp({ ...song, label: song.title, group: song.collection });
      filterStamps();
    },
    setActive(value) {
      const next = Boolean(value) && !disposed;
      if (active === next) return;
      active = next;
      monitor?.setActive(active);
      if (!active) { cancelPending(); return; }
      midiEditor.refresh();
    },
    dispose() { if (disposed) return; disposed = true; active = false; editTicket++; editRequest?.abort(); cancelPending(); fileCache.clear(); for (const record of saved.values()) record.events.abort(); saved.clear(); padSamples.clear(); if (previewFrame !== null) cancelAnimationFrame(previewFrame); monitor?.dispose(); engine.stopSamples(); automata.dispose(); midiEditor.destroy(); events.abort(); visualizer.remove(); volume.remove(); automataTools.remove(); savedPads.remove(); palette.remove(); shapeControls.remove(); messageForm.remove(); section.remove(); },
  };
}

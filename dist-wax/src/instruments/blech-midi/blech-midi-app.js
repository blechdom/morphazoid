import { mountSoundFontChooser } from '../../sound-fonts/chooser.js';
import { mountMidiNoteEffectEditor } from '../../midi-note-effects-controls.js';
import { MidiMixerEngine } from '../midi-mixer/midi-mixer-engine.js';
import { mountMixerPerformance } from '../midi-mixer/midi-mixer-performance.js';
import { mountMixerKnobs } from '../midi-mixer/midi-mixer-knobs.js';
import { mountMidiSynthEffectEditor } from '../midi-mixer/midi-mixer-midi-editor.js';
import { mountMidiDrawing, DRAWING_COLUMNS, DRAWING_ROWS } from '../midiphoria/midiphoria-drawing.js';
import { GM_PROGRAM_NAMES, parseMidi } from '../midi-mixer/midi-mixer-model.js';
import { mountMidiArtCreator } from './blech-midi-art-controls.js';
import { mountBlechFilePlayer } from './blech-midi-file-player.js';

const $ = id => document.getElementById(id);
let retainedDraft = null;

function mountBlechMidi() {
  const events = new AbortController();
  const on = (node, type, listener) => node.addEventListener(type, listener, { signal: events.signal });
  $('mixerFontStatus').textContent = ''; $('creativeStatus').textContent = '';
  let disposed = false, frame = null, lastReflect = -Infinity, downloadUrl = null, starting = false, audioIntent = false;
  let engine, performanceView, drawing, knobs, synthEffectEditor, noteEffectEditor, artCreator, filePlayer;
  let bankChooser, effectsSignature = '';
  let sharedBank = null, bankQueue = Promise.resolve();
  let seedPicking = false;
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
    $('audioButton').setAttribute('aria-pressed', String(enabled));
    $('audioButton').classList.toggle('is-loading', starting);
    field($('audioState'), starting ? 'starting' : enabled ? 'on' : state.error ? 'retry' : 'off');
    $('creativeAudioStart').hidden = enabled;
    $('creativeAudioStart').disabled = starting;
    field($('creativeAudioStart'), starting ? 'Starting audio…' : state.error ? 'Retry audio' : 'Turn audio on');
    $('playButton').disabled = !drawing?.model.count;
    $('previewDrawingMidi').disabled = !drawing?.model.count;
    const playing = state.samples.length;
    field($('creativePlaybackStatus'), `${playing} pad${playing === 1 ? '' : 's'}${state.automata?.playing ? ' + evolution' : ''}${enabled ? '' : ' · audio off'}`);
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
    if (state.error) field($('creativeStatus'), state.error);
  }
  drawing = mountMidiDrawing({ canvas: $('drawingCanvas'), status: $('drawingStatus'),
    undoButton: $('drawingUndo'), clearButton: $('drawingClear'), eraseButton: $('drawingErase'),
    onChange: model => { performanceView?.cancelEdit(); $('generateDrawingMidi').disabled = !model.count; refreshSeedBridge(model); revokeDownload(); reflect(); },
    onSeedRow: row => { $('drawingSeedRow').value = String(row + 1); refreshSeedBridge(drawing?.model); } });
  if (retainedDraft) {
    drawing.model.pixels = retainedDraft.map(row => [...row]);
    $('generateDrawingMidi').disabled = !drawing.model.count; $('drawingClear').disabled = !drawing.model.count;
    $('drawingStatus').value = `${drawing.model.count} pixels`; $('drawingCanvas').dataset.pixels = String(drawing.model.count);
    drawing.render(); retainedDraft = null;
  }
  engine = new MidiMixerEngine({ onState: reflect });
  engine.setVolume(Number($('outputLevel').value));
  engine.setTempo(Number($('creativeTempo').value));
  performanceView = mountMixerPerformance($('creativeControlsHost'), { engine,
    getDrawing: () => drawing.model.count ? drawing.model.score() : null,
    visualizerHost: $('creativeVisualizerHost'), volumeHost: $('creativeVolumeHost'), automataHost: $('automataMidiTools'), padsHost: $('creativePadsHost'),
    liveAutomata: true, shapeHost: $('drawingShapeControls'), messageHost: $('drawingMessageHost'), onEditDrawing: loadDrawingCopy });
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
  const canvas = $('mixerPerformanceCanvas');
  canvas.setAttribute('aria-label', 'Live Blech MIDI output: pitch runs left to right and notes rise from bottom to top');
  canvas.textContent = 'Sent drawings, stamps, messages and rules appear together, colored by voice.';
  $('creativeVisualizerHost').querySelector('.mixer-performance-key').textContent = 'Live output';
  $('drawingPlaybackOptions').append($('creativeControlsHost').querySelector('.mixer-stamp-switches'));
  $('mixerSampleLevel').closest('label').querySelector('b').textContent = 'Pads';
  filePlayer = mountBlechFilePlayer($('blackMidiPlayer'), { engine, creditsHost: $('blackMidiCredits'),
    onAudioRequest: () => {
      if (starting) return;
      if (engine.state.audioEnabled) void filePlayer.enableAudio();
      else $('audioButton').click();
    },
  });
  knobs = mountMixerKnobs($('blechMidi'));
  artCreator = mountMidiArtCreator($('midiArtCreator'), {
    getDrawingScore: () => { const score = performanceView.getDrawingScore(); return { ...score, analysis: score.analysis ?? parseMidi(score.buffer) }; },
    getTempo: () => engine.state.tempo,
    onSend: (score, options) => performanceView.sendScore(score, options),
    onPreview: score => filePlayer.previewScore(score),
  });
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
      for (let y = start; y < Math.max(start + 1, end) && y < DRAWING_ROWS; y++) pixels[y][x] = 1;
    }
    for (const [id, value] of [['mixerStampSpan', span], ['mixerStampDrawBase', base], ['mixerStampOffset', 0], ['mixerStampBeats', Math.min(64, duration)]]) {
      $(id).value = String(value); $(id).dispatchEvent(new Event('input', { bubbles: true }));
    }
    drawing.loadPixels(pixels);
    field($('creativeStatus'), `${name} copied into the 48 × 32 drawing grid. Send creates a new pad.`);
    $('drawingEditor').scrollIntoView({ block: 'start', behavior: 'smooth' });
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
      const score = performanceView.playDrawing();
      if (!score?.buffer) return;
      revokeDownload(); downloadUrl = URL.createObjectURL(new Blob([score.buffer], { type: 'audio/midi' }));
      $('downloadDrawingMidi').href = downloadUrl; $('downloadDrawingMidi').hidden = false;
      field($('creativeStatus'), ''); reflect();
    } catch (error) { field($('creativeStatus'), error.message || 'Could not send this drawing.'); }
  }
  on($('generateDrawingMidi'), 'click', sendDrawing);
  on($('playButton'), 'click', sendDrawing);
  on($('previewDrawingMidi'), 'click', async () => {
    try { await filePlayer.previewScore(performanceView.getDrawingScore(), 'Your drawing'); }
    catch (error) { field($('creativeStatus'), error.message); }
  });
  on($('creativeStop'), 'click', () => { performanceView.stopSamples(); engine.setAutomataPlaying(false); filePlayer.stop(); reflect(); });
  for (const button of document.querySelectorAll('[data-drawing-stamp]')) on(button, 'click', () => drawing.stamp(button.dataset.drawingStamp));
  on($('creativeTempo'), 'input', () => {
    const tempo = engine.setTempo(Number($('creativeTempo').value));
    $('creativeTempoOut').value = `${Number(tempo.toFixed(1))} BPM`;
    filePlayer.setTempo();
  });
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
  bankChooser = mountSoundFontChooser($('mixerBankChooser'), {
    fileInput: $('mixerSoundFont'), defaultButton: $('mixerDefaultFont'),
    onLoad: loadSharedBank,
    onStatus(state) { if (!disposed) field($('mixerFontStatus'), state.error?.message || (state.loading ? 'Loading SoundFont…' : state.current ? `Using ${state.current.name}` : '')); },
  });
  on($('audioButton'), 'click', async () => {
    audioIntent = !(starting ? audioIntent : engine.state.audioEnabled);
    if (!audioIntent) { starting = false; performanceView.cancelPending(); engine.setAudioEnabled(false); filePlayer.setAudioEnabled(false); reflect(); return; }
    starting = true; field($('creativeStatus'), '');
    // Creating and resuming the native context stays inside this explicit gesture.
    const pending = engine.enableAudio(); reflect();
    try { if (await pending && !disposed && audioIntent) await filePlayer.enableAudio(); }
    finally { if (!disposed) { starting = false; if (!audioIntent) { engine.setAudioEnabled(false); filePlayer.setAudioEnabled(false); } reflect(); } }
  });
  on($('creativeAudioStart'), 'click', () => { if (!engine.state.audioEnabled && !starting) $('audioButton').click(); });
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
    disposed = true; audioIntent = false; bankChooser?.dispose(); revokeDownload(); events.abort();
    if (frame !== null) cancelAnimationFrame(frame);
    $('drawingPlaybackOptions').querySelector('.mixer-stamp-switches')?.remove();
    artCreator.dispose(); filePlayer.dispose(); performanceView.dispose(); noteEffectEditor.destroy(); drawing.destroy(); synthEffectEditor.destroy(); knobs.destroy(); void engine.dispose();
  });
  performanceView.setView('draw', $('creativeVisualizerHost')); performanceView.setActive(!document.hidden); reflect();
  if (location.hash === '#automata') $('automataMidiTools').scrollIntoView({ block: 'start' });
  if (!document.hidden) frame = requestAnimationFrame(tick);
  void fetch(new URL('../../../assets/midiphoria/collection.json', import.meta.url), { signal: events.signal })
    .then(response => { if (!response.ok) throw new Error('File stamps could not load. Drawings and generated patterns are ready.'); return response.json(); })
    .then(collection => { if (!disposed) { performanceView.setCollection(collection); filePlayer.setCollection(collection); } })
    .catch(error => { if (!disposed && error.name !== 'AbortError') field($('creativeStatus'), error.message); });
}

mountBlechMidi();
globalThis.addEventListener('pageshow', event => { if (event.persisted) mountBlechMidi(); });

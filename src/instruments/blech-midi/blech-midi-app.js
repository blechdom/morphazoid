import { MidiMixerEngine } from '../midi-mixer/midi-mixer-engine.js';
import { mountMixerPerformance } from '../midi-mixer/midi-mixer-performance.js';
import { mountMixerKnobs } from '../midi-mixer/midi-mixer-knobs.js';
import { mountMidiDrawing } from '../midiphoria/midiphoria-drawing.js';

const $ = id => document.getElementById(id);
let retainedDraft = null, retainedView = null;

function mountBlechMidi() {
  const events = new AbortController();
  const on = (node, type, listener) => node.addEventListener(type, listener, { signal: events.signal });
  let disposed = false, frame = null, lastReflect = -Infinity, downloadUrl = null, starting = false, audioIntent = false;
  let engine, performanceView, drawing, knobs;
  let view = retainedView ?? (location.hash === '#automata' ? 'automata' : 'draw');
  const field = (node, value) => { if (node.textContent !== value) node.textContent = value; };
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
    const rule = $('automataMidiGenerate');
    $('playButton').disabled = view === 'draw' ? !drawing?.model.count : !rule || rule.disabled;
    $('playButton').setAttribute('aria-label', view === 'draw' ? 'Send prepared drawing' : 'Send Automatapoeia rule');
    field($('playButton'), view === 'draw' ? 'Send ↑' : 'Send rule ↑');
    field($('creativePlaybackStatus'), state.samples.length ? `${state.samples.length} playing${enabled ? '' : ' · silent preview'}` : 'Ready');
    $('blechMidi').dataset.audio = String(enabled);
    $('blechMidi').dataset.samples = String(state.samples.length);
    if (state.error) field($('creativeStatus'), state.error);
  }
  drawing = mountMidiDrawing({ canvas: $('drawingCanvas'), status: $('drawingStatus'),
    undoButton: $('drawingUndo'), clearButton: $('drawingClear'), eraseButton: $('drawingErase'),
    onChange: model => { $('generateDrawingMidi').disabled = !model.count; revokeDownload(); reflect(); } });
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
    visualizerHost: $('creativeVisualizerHost'), volumeHost: $('creativeVolumeHost'), automataHost: $('automataMidiTools') });
  const canvas = $('mixerPerformanceCanvas');
  canvas.setAttribute('aria-label', 'Live Blech MIDI output: pitch runs left to right and notes rise from bottom to top');
  canvas.textContent = 'Sent drawings, stamps, messages and rules appear together, colored by voice.';
  $('creativeVisualizerHost').querySelector('.mixer-performance-key').textContent = 'Live output';
  $('creativeFlowControls').prepend($('creativeControlsHost').querySelector('.mixer-stamp-switches'));
  $('mixerSampleSync').parentElement.title = 'Follow the tempo knob. Turn off to use each source’s original timing.';
  $('mixerSampleLoop').parentElement.title = 'Repeat active patterns. Turn off to finish the current cycle.';
  const ruleButton = $('automataMidiGenerate');
  ruleButton.textContent = 'Send rule ↑';
  knobs = mountMixerKnobs($('blechMidi'));

  function setView(next) {
    if (disposed) return;
    view = next === 'automata' ? 'automata' : 'draw';
    $('blechMidi').dataset.view = view;
    $('drawingEditor').hidden = view !== 'draw'; $('automataMidiTools').hidden = view !== 'automata';
    $('drawingModeButton').setAttribute('aria-pressed', String(view === 'draw'));
    $('automataModeButton').setAttribute('aria-pressed', String(view === 'automata'));
    performanceView.setView(view, $('creativeVisualizerHost'));
    if (view === 'draw') drawing.render();
    reflect();
  }
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
  on($('playButton'), 'click', () => { if (view === 'draw') sendDrawing(); else ruleButton.click(); });
  on($('creativeStop'), 'click', () => { performanceView.stopSamples(); reflect(); });
  on($('drawingModeButton'), 'click', () => setView('draw'));
  on($('automataModeButton'), 'click', () => setView('automata'));
  for (const button of document.querySelectorAll('[data-drawing-stamp]')) on(button, 'click', () => drawing.stamp(button.dataset.drawingStamp));
  on($('creativeTempo'), 'input', () => {
    const tempo = engine.setTempo(Number($('creativeTempo').value));
    $('creativeTempoOut').value = `${Number(tempo.toFixed(1))} BPM`;
  });
  on($('outputLevel'), 'input', () => { engine.setVolume(Number($('outputLevel').value)); $('outputLevelOut').value = `${Math.round(engine.state.volume * 100)}%`; });
  on($('audioButton'), 'click', async () => {
    audioIntent = !(starting ? audioIntent : engine.state.audioEnabled);
    if (!audioIntent) { starting = false; performanceView.cancelPending(); engine.setAudioEnabled(false); reflect(); return; }
    starting = true; field($('creativeStatus'), '');
    // Creating and resuming the native context stays inside this explicit gesture.
    const pending = engine.enableAudio(); reflect();
    try { await pending; }
    finally { if (!disposed) { starting = false; if (!audioIntent) engine.setAudioEnabled(false); reflect(); } }
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
    retainedDraft = drawing.model.pixels.map(row => [...row]); retainedView = view;
    disposed = true; audioIntent = false; revokeDownload(); events.abort();
    if (frame !== null) cancelAnimationFrame(frame);
    // The shared Loop/Sync row was relocated outside the module's section.
    // Remove that owner too before a possible back/forward-cache remount.
    $('creativeFlowControls').querySelector('.mixer-stamp-switches')?.remove();
    performanceView.dispose(); drawing.destroy(); knobs.destroy(); void engine.dispose();
  });
  setView(view); performanceView.setActive(!document.hidden); reflect();
  if (!document.hidden) frame = requestAnimationFrame(tick);
  void fetch(new URL('../../../assets/midiphoria/collection.json', import.meta.url), { signal: events.signal })
    .then(response => { if (!response.ok) throw new Error('File stamps could not load. Drawings and generated patterns are ready.'); return response.json(); })
    .then(collection => { if (!disposed) performanceView.setCollection(collection); })
    .catch(error => { if (!disposed && error.name !== 'AbortError') field($('creativeStatus'), error.message); });
}

mountBlechMidi();
globalThis.addEventListener('pageshow', event => { if (event.persisted) mountBlechMidi(); });

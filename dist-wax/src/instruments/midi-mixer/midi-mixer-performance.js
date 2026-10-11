import { MidiphoriaModel, DEFAULT_VISUALS } from '../midiphoria/midiphoria-model.js';
import { MidiphoriaRenderer } from '../midiphoria/midiphoria-renderer.js';
import { GM_PROGRAM_NAMES, parseMidi } from './midi-mixer-model.js';
import { createMidiFileStamp } from './midi-mixer-file-stamps.js';
import { MIXER_SAMPLE_STAMPS, mixerStampScore, nextMixerStampVariation, mixerMessageScore, mixerPerformanceScore, mixerPerformanceChannel,
  indexPerformanceNotes, queryPerformanceNotes } from './midi-mixer-performance-score.js';

const clock = () => performance.now() / 1000;
const clamp = (value, low, high) => Math.max(low, Math.min(high, value));
const MAX_ACTIVE = 4096;

/** Combined graphic and sample controls. Audio stays exclusively in the engine. */
export function mountMixerPerformance(host, { engine, getDrawing } = {}) {
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
    <div class="mixer-sample-bank" role="group" aria-label="One-shot MIDI samples"></div>
  </div>
  <div class="mixer-stamp-shape-controls">
    <label>Density <output id="mixerStampDensityOut">50%</output><input id="mixerStampDensity" type="range" min="0" max="1" step=".05" value=".5" /></label>
    <label>Pitch span <output id="mixerStampSpanOut">48 notes</output><input id="mixerStampSpan" type="range" min="12" max="48" step="1" value="48" /></label>
    <label>Length <output id="mixerStampBeatsOut">8 beats</output><input id="mixerStampBeats" type="range" min="4" max="32" step="4" value="8" /></label>
    <div class="mixer-stamp-actions"><button id="mixerStampAgain" type="button">Stamp again</button><button id="mixerStampVariation" type="button">Variation</button><button id="mixerStampNextSlice" type="button" hidden>Next slice</button></div>
    <label class="mixer-stamp-paint"><input id="mixerStampPaint" type="checkbox" checked />Paint flow</label>
    <span id="mixerStampHint">Tap a stamp, or drag across the flow to place it by pitch.</span>
  </div>
  <div class="mixer-sample-controls">
    <label>Sample sound <select id="mixerSampleProgram"></select></label>
    <label>Sample level <input id="mixerSampleLevel" type="range" min="0" max="1" step="0.01" value="0.7" /></label>
    <button id="mixerSendDrawing" type="button">Play drawing</button>
    <button id="mixerStopSamples" type="button">Stop samples</button>
  </div>
  <form class="mixer-sample-message"><label class="sr-only" for="mixerSampleMessage">Message as MIDI</label>
    <input id="mixerSampleMessage" type="text" maxlength="64" placeholder="Send a word, 🙂 ⭐ ❤ …" autocomplete="off" spellcheck="false" />
    <button id="mixerSendMessage" type="submit">Send</button>
  </form>
  <p id="mixerSampleStatus" class="midiphoria-help" role="status"></p>
  <a id="mixerStampCredit" class="mixer-stamp-credit" target="_blank" rel="noopener" hidden></a>`;
  host.append(section);
  const $ = id => section.querySelector(`#${id}`), canvas = $('mixerPerformanceCanvas');
  const events = new AbortController();
  const on = (node, type, listener) => node.addEventListener(type, listener, { signal: events.signal });
  const renderer = new MidiphoriaRenderer(canvas), model = new MidiphoriaModel();
  renderer.configure({ colorSource: 'voice', view: 'trails', motion: 0, width: .65, glow: .12, reflection: 'none', trailSeconds: 6 });
  const activeNotes = new Map(), preview = new Map(), indexes = new WeakMap();
  let active = false, disposed = false, frame = null, lastFrame = -Infinity, audioWasEnabled = null, serial = 0;
  const stamps = new Map(), buttons = new Map(), fileCache = new Map();
  let selected = 'heart', seed = 1, request = null, requestTicket = 0, loadingSample = false, previewFrame = null;
  let patternProgram = '81', fileProgram = 'original', fileStart = null, lastFileStamp = null, nextVariation = null, pointer = null;
  $('mixerSampleProgram').add(new Option('Original file instruments', 'original'));
  for (const program of [0, 4, 7, 11, 12, 38, 48, 52, 56, 73, 80, 81, 89]) $('mixerSampleProgram').add(new Option(GM_PROGRAM_NAMES[program], String(program)));
  $('mixerSampleProgram').value = '81';
  $('mixerSendDrawing').hidden = typeof getDrawing !== 'function';

  function noteMessage(event) {
    return { type: event.type, sourceId: `${event.sourceId}:channel:${event.channel}`, channel: event.channel % 16,
      note: event.note, velocity: event.velocity ?? 0 };
  }
  function release(id, now) {
    const held = activeNotes.get(id); if (!held) return;
    activeNotes.delete(id);
    model.handleMessage({ ...noteMessage(held.event), type: 'noteOff', velocity: 0 }, now);
    renderer.captureEvent({ ...held.event, id, type: 'noteOff', time: now,
      channel: mixerPerformanceChannel(held.event.sourceId, held.event.channel) });
  }
  function attack(event, at, duration) {
    const id = String(event.id);
    if (activeNotes.has(id) || activeNotes.size >= MAX_ACTIVE || !Number.isInteger(event.note) || event.note < 0 || event.note > 127 || !(event.velocity > 0) || event.gain <= 0) return;
    const seconds = Number.isFinite(duration) ? clamp(duration, .001, 120) : .25;
    activeNotes.set(id, { event, end: at + seconds });
    model.handleMessage(noteMessage(event), at);
    renderer.captureEvent({ ...event, id, type: 'noteOn', time: at,
      channel: mixerPerformanceChannel(event.sourceId, event.channel) });
  }
  function clear() { activeNotes.clear(); preview.clear(); model.panic(clock()); renderer.clear(); }
  const unsubscribe = engine.subscribeNotes(batch => {
    if (!active || disposed || !engine.state.audioEnabled) return;
    if (audioWasEnabled !== true) { clear(); audioWasEnabled = true; }
    const now = clock(), audioTime = engine.context?.currentTime ?? 0;
    for (const item of batch) {
      const at = Math.min(now, now + (Number.isFinite(item.at) ? item.at - audioTime : 0));
      const event = { ...item, id: `live:${item.id}`, channel: Number(item.channel) || 0 };
      if (event.type === 'noteOff') release(String(event.id), at);
      else attack(event, at, (item.duration ?? .25) + .25);
    }
  });

  function previewSource(source, now) {
    const { key, analysis, position, rate = 1, gain = 1, transpose = 0, channels = [], end = Infinity } = source;
    if (!analysis || gain <= .0001 || !Number.isFinite(position)) return;
    let indexed = indexes.get(analysis);
    if (!indexed) { indexed = indexPerformanceNotes(analysis.notes); indexes.set(analysis, indexed); }
    const signature = JSON.stringify([rate, transpose, channels.map(channel => [channel.channel, channel.mute, channel.solo])]);
    let prior = preview.get(key);
    if (!prior || prior.signature !== signature || prior.analysis !== analysis || position < prior.position || position - prior.position > 2 * rate) {
      for (const [id, held] of activeNotes) if (held.event.sourceId === key) release(id, now);
      prior = { analysis, signature, position: Math.max(0, position - .001), generation: ++serial, seen: new Set() };
      preview.set(key, prior);
    }
    const secondsPerBeat = 60 / Math.max(30, engine.state.tempo) / rate;
    const settings = new Map(channels.map(channel => [channel.channel, channel])), solo = channels.some(channel => channel.solo);
    for (const { index, note } of queryPerformanceNotes(indexed, prior.position, position, 1024)) {
      const setting = settings.get(note.channel);
      if (setting?.mute || (solo && !setting?.solo)) continue;
      const id = `preview:${key}:${prior.generation}:${index}`;
      if (prior.seen.has(index)) continue;
      prior.seen.add(index);
      const audibleNote = note.note + (note.channel % 16 === 9 ? 0 : transpose);
      const noteEnd = Math.min(end, note.beat + note.duration);
      const at = now - Math.max(0, position - note.beat) * secondsPerBeat;
      attack({ id, type: 'noteOn', sourceId: key, channel: note.channel, note: audibleNote, velocity: note.velocity, gain }, at, (noteEnd - note.beat) * secondsPerBeat);
    }
    // Index ownership is reset at every loop; cap display bookkeeping on long files.
    if (prior.seen.size > 8192) prior.seen = new Set([...prior.seen].slice(-4096));
    prior.position = position;
  }

  function draw() {
    frame = null; if (!active || disposed || document.hidden) return;
    const now = clock();
    if (now - lastFrame >= 1 / 30) {
      lastFrame = now;
      const state = engine.state;
      if (audioWasEnabled !== state.audioEnabled) { clear(); audioWasEnabled = state.audioEnabled; }
      if (!state.audioEnabled) {
        const sources = new Set();
        if (state.playing) state.decks.forEach((deck, index) => {
          const key = `deck:${index}`;
          const fade = index === 0 ? Math.cos((state.crossfade + 1) * Math.PI / 4) : Math.sin((state.crossfade + 1) * Math.PI / 4);
          const gain = deck.config.mute ? 0 : (deck.config.gain ?? 1) * fade;
          if (gain <= .0001) return;
          sources.add(key);
          previewSource({ key, analysis: deck.analysis, position: deck.positionBeats, rate: deck.config.rate ?? 1,
            gain, transpose: deck.config.transpose, channels: deck.channels, end: deck.loopEndBeats }, now);
        });
        for (const sample of state.samples ?? []) {
          const key = `sample:${sample.id}`; sources.add(key);
          previewSource({ key, analysis: sample.analysis, position: sample.positionBeats, gain: sample.gain }, now);
        }
        for (const [id, held] of activeNotes) if (!sources.has(held.event.sourceId)) release(id, now);
        for (const key of preview.keys()) if (!sources.has(key)) preview.delete(key);
      }
      for (const [id, held] of activeNotes) if (held.end <= now) release(id, held.end);
      renderer.draw(model.sample(now), now, DEFAULT_VISUALS);
      canvas.dataset.activeNotes = String(activeNotes.size);
      canvas.dataset.capturedNotes = String(renderer.capturedNotes);
      canvas.dataset.sources = JSON.stringify([...new Set([...activeNotes.values()].map(held => held.event.sourceId))].sort());
      canvas.dataset.historySources = JSON.stringify([...new Set(renderer.trails.map(note => note.sourceId))].slice(0, 64).sort());
      $('mixerStopSamples').disabled = !(state.samples?.length) && !loadingSample;
    }
    frame = requestAnimationFrame(draw);
  }

  function playScore(score, label, detail = '') {
    if (!score?.buffer) throw new Error('Draw a score first in Draw a MIDI.');
    const program = $('mixerSampleProgram').value;
    engine.triggerSample(score.buffer, { name: label, program: program === 'original' ? null : Number(program), gain: Number($('mixerSampleLevel').value) });
    canvas.dataset.message = label;
    $('mixerSampleStatus').textContent = `${label} · ${engine.state.audioEnabled ? 'sample' : 'silent preview'}${detail ? ` · ${detail}` : ''}${score.unsupported?.length ? ` · skipped ${score.unsupported.join(' ')}` : ''}`;
  }
  function fail(error) { if (!disposed && error?.name !== 'AbortError') $('mixerSampleStatus').textContent = error.message || 'Could not play this sample.'; }
  function safely(action) { try { const result = action(); result?.catch(fail); } catch (error) { fail(error); } }
  function cancelPending() {
    requestTicket++; request?.abort(); request = null;
    if (loadingSample && !disposed) $('mixerSampleStatus').textContent = 'Stamp loading canceled';
    loadingSample = false; pointer = null;
  }
  function options(transpose = 0) { return { seed, density: Number($('mixerStampDensity').value), span: Number($('mixerStampSpan').value), beats: Number($('mixerStampBeats').value), transpose }; }
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
    for (const stamp of stamps.values()) if (!stamp.file && !buttons.get(stamp.id).hidden) thumbnail(buttons.get(stamp.id), mixerStampScore(stamp.id, options()));
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
  function selectStamp(id) {
    const previous = stamps.get(selected), stamp = stamps.get(id); if (!stamp) return;
    if (previous?.file) fileProgram = $('mixerSampleProgram').value; else patternProgram = $('mixerSampleProgram').value;
    if (selected !== id) { fileStart = null; lastFileStamp = null; }
    selected = id; $('mixerSampleProgram').value = stamp.file ? fileProgram : patternProgram;
    for (const [key, button] of buttons) button.setAttribute('aria-pressed', String(key === id));
    for (const name of ['mixerStampDensity', 'mixerStampSpan']) $(name).disabled = Boolean(stamp.file);
    nextVariation = stamp.file ? null : nextMixerStampVariation(id, options());
    $('mixerStampVariation').disabled = !nextVariation;
    $('mixerStampNextSlice').hidden = !stamp.file || stamp.collection === 'Geometric patterns';
    const credit = $('mixerStampCredit'); credit.hidden = !stamp.file;
    if (stamp.file) { credit.href = stamp.sourceUrl || 'assets/midiphoria/SOURCE.md'; credit.textContent = `${stamp.artist || stamp.composer || 'Source'} · file credits ↗`; }
    canvas.dataset.stamp = id;
  }
  async function stampSelected(transpose = 0) {
    if (!active || disposed) return;
    cancelPending(); const ticket = requestTicket, stamp = stamps.get(selected); if (!stamp) return;
    if (!stamp.file) { playScore(mixerStampScore(stamp.id, options(transpose)), stamp.label); return; }
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
      const whole = stamp.collection === 'Geometric patterns';
      const score = createMidiFileStamp(analysis, { beats: options().beats, whole, ...(whole ? { fitBeats: options().beats } : {}), ...(fileStart === null || whole ? {} : { startBeat: fileStart }), transpose, name: stamp.label });
      lastFileStamp = score; thumbnail(buttons.get(stamp.id), score);
      const range = `${whole ? 'whole pattern' : 'excerpt'} · source beats ${score.sourceStartBeat.toFixed(1)}–${score.sourceEndBeat.toFixed(1)} · ${score.noteCount.toLocaleString()} notes`;
      playScore(score, stamp.label, `${range}${score.shortened ? ' · shorter dense slice' : ''}`);
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
    $('mixerStampSpanOut').value = `${options().span} notes`; $('mixerStampBeatsOut').value = `${options().beats} beats`; selectStamp(selected); queuePreviews();
  });
  on($('mixerStampAgain'), 'click', () => safely(() => stampSelected()));
  on($('mixerStampVariation'), 'click', () => { if (!nextVariation) return; seed = nextVariation.patternOptions.seed; selectStamp(selected); queuePreviews(); safely(() => stampSelected()); });
  on($('mixerStampNextSlice'), 'click', () => { fileStart = lastFileStamp?.nextStartBeat ?? null; safely(() => stampSelected()); });
  function paint(event) {
    const rect = canvas.getBoundingClientRect(), transpose = Math.round(clamp((event.clientX - rect.left) / rect.width * 128 - 72, -36, 36));
    safely(() => stampSelected(transpose));
  }
  on(canvas, 'pointerdown', event => {
    if (!$('mixerStampPaint').checked || !event.isPrimary || event.button !== 0) return;
    event.preventDefault(); canvas.setPointerCapture(event.pointerId); paint(event);
    pointer = { id: event.pointerId, x: event.clientX, at: clock() };
  });
  on(canvas, 'pointermove', event => {
    if (pointer?.id !== event.pointerId || Math.abs(event.clientX - pointer.x) < 12 || clock() - pointer.at < Math.max(.12, 30 / engine.state.tempo)) return;
    paint(event); pointer = { id: event.pointerId, x: event.clientX, at: clock() };
  });
  for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) on(canvas, type, () => { pointer = null; });
  on(canvas, 'keydown', event => { if (event.key === 'Enter') { event.preventDefault(); safely(() => stampSelected()); } });
  const paintMode = () => { canvas.style.touchAction = $('mixerStampPaint').checked ? 'none' : 'pan-y'; canvas.classList.toggle('mixer-painting', $('mixerStampPaint').checked); };
  on($('mixerStampPaint'), 'change', paintMode); paintMode();
  on(section.querySelector('form'), 'submit', event => {
    event.preventDefault(); cancelPending(); safely(() => { const score = mixerMessageScore($('mixerSampleMessage').value); playScore(score, score.text); });
  });
  on($('mixerSendDrawing'), 'click', () => { cancelPending(); safely(() => playScore(mixerPerformanceScore(getDrawing?.()), 'Your drawing')); });
  on($('mixerStopSamples'), 'click', () => { cancelPending(); engine.stopSamples(); $('mixerSampleStatus').textContent = 'Samples stopped'; });
  on($('mixerPerformanceView'), 'change', () => renderer.configure({ view: $('mixerPerformanceView').value }));
  const resize = new ResizeObserver(() => { if (active) renderer.resize(); }); resize.observe(canvas);
  return {
    cancelPending,
    setCollection(collection) {
      for (const song of collection) if (song.file && /black midi|geometric/i.test(song.collection || '')) addStamp({ ...song, label: song.title, group: song.collection });
      filterStamps();
    },
    setActive(value) {
      active = Boolean(value) && !disposed;
      if (!active) { cancelPending(); if (frame !== null) cancelAnimationFrame(frame); frame = null; clear(); return; }
      renderer.resize(); if (frame === null) draw();
    },
    dispose() { if (disposed) return; disposed = true; active = false; cancelPending(); fileCache.clear(); if (frame !== null) cancelAnimationFrame(frame); if (previewFrame !== null) cancelAnimationFrame(previewFrame); unsubscribe(); engine.stopSamples(); resize.disconnect(); events.abort(); section.remove(); },
  };
}

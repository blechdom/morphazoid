import { MidiphoriaModel, DEFAULT_VISUALS } from '../midiphoria/midiphoria-model.js';
import { MidiphoriaRenderer } from '../midiphoria/midiphoria-renderer.js';
import { GM_PROGRAM_NAMES } from './midi-mixer-model.js';
import { MIXER_SAMPLE_STAMPS, mixerStampScore, mixerMessageScore, mixerPerformanceScore, mixerPerformanceChannel,
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
  <canvas id="mixerPerformanceCanvas" aria-label="Combined MIDI notes: pitch runs left to right and time rises from bottom to top">Both decks and sample notes appear together, colored by voice.</canvas>
  <div class="mixer-sample-bank" role="group" aria-label="One-shot MIDI samples"></div>
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
  <p id="mixerSampleStatus" class="midiphoria-help" role="status"></p>`;
  host.append(section);
  const $ = id => section.querySelector(`#${id}`), canvas = $('mixerPerformanceCanvas');
  const events = new AbortController();
  const on = (node, type, listener) => node.addEventListener(type, listener, { signal: events.signal });
  const renderer = new MidiphoriaRenderer(canvas), model = new MidiphoriaModel();
  renderer.configure({ colorSource: 'voice', view: 'trails', motion: 0, width: .65, glow: .12, reflection: 'none', trailSeconds: 6 });
  const activeNotes = new Map(), preview = new Map(), indexes = new WeakMap();
  let active = false, disposed = false, frame = null, lastFrame = -Infinity, audioWasEnabled = null, serial = 0;
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
      $('mixerStopSamples').disabled = !(state.samples?.length);
    }
    frame = requestAnimationFrame(draw);
  }

  function playScore(score, label) {
    if (!score?.buffer) throw new Error('Draw a score first in Draw a MIDI.');
    engine.triggerSample(score.buffer, { name: label, program: Number($('mixerSampleProgram').value), gain: Number($('mixerSampleLevel').value) });
    canvas.dataset.message = label;
    $('mixerSampleStatus').textContent = `${label} · ${engine.state.audioEnabled ? 'sample' : 'silent preview'}${score.unsupported?.length ? ` · skipped ${score.unsupported.join(' ')}` : ''}`;
  }
  function safely(action) { try { action(); } catch (error) { $('mixerSampleStatus').textContent = error.message || 'Could not play this sample.'; } }
  for (const stamp of MIXER_SAMPLE_STAMPS) {
    const button = document.createElement('button'); button.type = 'button'; button.dataset.mixerSample = stamp.id; button.textContent = stamp.label;
    on(button, 'click', () => safely(() => playScore(mixerStampScore(stamp.id), stamp.label)));
    section.querySelector('.mixer-sample-bank').append(button);
  }
  on(section.querySelector('form'), 'submit', event => {
    event.preventDefault(); safely(() => { const score = mixerMessageScore($('mixerSampleMessage').value); playScore(score, score.text); });
  });
  on($('mixerSendDrawing'), 'click', () => safely(() => playScore(mixerPerformanceScore(getDrawing?.()), 'Your drawing')));
  on($('mixerStopSamples'), 'click', () => { engine.stopSamples(); $('mixerSampleStatus').textContent = 'Samples stopped'; });
  on($('mixerPerformanceView'), 'change', () => renderer.configure({ view: $('mixerPerformanceView').value }));
  const resize = new ResizeObserver(() => { if (active) renderer.resize(); }); resize.observe(canvas);
  return {
    setActive(value) {
      active = Boolean(value) && !disposed;
      if (!active) { if (frame !== null) cancelAnimationFrame(frame); frame = null; clear(); return; }
      renderer.resize(); if (frame === null) draw();
    },
    dispose() { if (disposed) return; disposed = true; active = false; if (frame !== null) cancelAnimationFrame(frame); unsubscribe(); engine.stopSamples(); resize.disconnect(); events.abort(); section.remove(); },
  };
}

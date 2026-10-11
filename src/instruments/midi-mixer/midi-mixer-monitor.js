import { midiNoteEffectChildren } from '../../midi-note-effects.js';
import { MidiphoriaModel, DEFAULT_VISUALS } from '../midiphoria/midiphoria-model.js';
import { MidiphoriaRenderer } from '../midiphoria/midiphoria-renderer.js';
import { mergeMidiParameters, transformMidiNote } from './midi-mixer-parameters.js';
import { mixerPerformanceChannel, indexPerformanceNotes, queryPerformanceNotes } from './midi-mixer-performance-score.js';

const clock = () => performance.now() / 1000;
const clamp = (value, low, high) => Math.max(low, Math.min(high, value));
const MAX_ACTIVE = 4096;

/** Shared note display; it never owns transport, audio or stamp controls. */
export function mountMidiPerformanceMonitor(canvas, { engine, onFrame = () => {} }) {
  const renderer = new MidiphoriaRenderer(canvas), model = new MidiphoriaModel();
  renderer.configure({ colorSource: 'voice', view: 'trails', motion: 0, width: .65, glow: .12, reflection: 'none', trailSeconds: 6 });
  const activeNotes = new Map(), scheduledNotes = new Map(), preview = new Map(), indexes = new WeakMap();
  let active = false, disposed = false, frame = null, lastFrame = -Infinity, audioWasEnabled = null, serial = 0;
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
  function clear() { activeNotes.clear(); scheduledNotes.clear(); preview.clear(); model.panic(clock()); renderer.clear(); }
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
    const { key, analysis, position, rate = 1, tempo = engine.state.tempo, cycle = 0, gain = 1, transpose = 0, channels = [], midi = {}, end = Infinity } = source;
    if (!analysis || !Number.isFinite(position)) return;
    let indexed = indexes.get(analysis);
    if (!indexed) { indexed = indexPerformanceNotes(analysis.notes); indexes.set(analysis, indexed); }
    const signature = JSON.stringify([cycle, rate, transpose, gain, midi, channels.map(channel => [channel.channel, channel.mute, channel.solo, channel.midi])]);
    let prior = preview.get(key);
    if (!prior || prior.signature !== signature || prior.analysis !== analysis || position < prior.position || position - prior.position > 2 * rate) {
      for (const [id, held] of activeNotes) if (held.event.sourceId === key) release(id, now);
      for (const [id, held] of scheduledNotes) if (held.event.sourceId === key) scheduledNotes.delete(id);
      prior = { analysis, signature, position: Math.max(0, position - .001), generation: ++serial, seen: new Set() };
      preview.set(key, prior);
    }
    if (gain <= .0001) return;
    const secondsPerBeat = 60 / Math.max(1, tempo) / rate;
    const settings = new Map(channels.map(channel => [channel.channel, channel])), solo = channels.some(channel => channel.solo);
    for (const { index, note } of queryPerformanceNotes(indexed, prior.position, position, 1024)) {
      const setting = settings.get(note.channel);
      if (setting?.mute || (solo && !setting?.solo)) continue;
      const id = `preview:${key}:${prior.generation}:${index}`;
      if (prior.seen.has(index)) continue;
      prior.seen.add(index);
      const parameters = mergeMidiParameters(midi, setting?.midi);
      const previewGain = gain * (parameters.gain ?? 1);
      if (previewGain <= .0001 || parameters.controllers?.[7] === 0 || parameters.controllers?.[11] === 0) continue;
      const transformed = transformMidiNote({ ...note, note: note.note + (note.channel % 16 === 9 ? 0 : transpose) }, parameters);
      const noteEnd = Math.min(end, note.beat + note.duration);
      const at = now - Math.max(0, position - note.beat) * secondsPerBeat;
      const children = midiNoteEffectChildren({ ...engine.state.noteEffects, tempo: engine.state.tempo }, transformed.note, transformed.velocity,
        { drums: Boolean(analysis.channels.find(channel => channel.channel === note.channel)?.drums) });
      children.forEach((child, childIndex) => {
        if (scheduledNotes.size + activeNotes.size >= MAX_ACTIVE) return;
        const event = { id: `${id}:${childIndex}`, type: 'noteOn', sourceId: key, channel: note.channel,
          note: child.note, velocity: child.velocity, gain: previewGain };
        const start = at + child.delaySeconds, duration = Math.min((noteEnd - note.beat) * secondsPerBeat, child.gateSeconds);
        if (start > now) scheduledNotes.set(event.id, { event, at: start, duration });
        else if (start + duration > now) attack(event, start, duration);
      });
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
          if (gain <= .0001 || deck.weaveActive === false) return;
          sources.add(key);
          previewSource({ key, analysis: deck.analysis, position: deck.positionBeats, rate: deck.config.rate ?? 1,
            gain, transpose: deck.config.transpose, channels: deck.channels, midi: deck.config.midi, end: deck.loopEndBeats }, now);
        });
        for (const sample of state.samples ?? []) {
          if (sample.pending) continue;
          const key = `sample:${sample.id}`; sources.add(key);
          previewSource({ key, analysis: sample.analysis, position: sample.positionBeats, tempo: sample.tempo, cycle: sample.cycle,
            gain: sample.gain, midi: sample.midi, end: sample.analysis.durationBeats }, now);
        }
        for (const [id, held] of scheduledNotes) {
          if (!sources.has(held.event.sourceId)) scheduledNotes.delete(id);
          else if (held.at <= now) { scheduledNotes.delete(id); if (held.at + held.duration > now) attack(held.event, held.at, held.duration); }
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
      onFrame(state);
    }
    frame = requestAnimationFrame(draw);
  }

  const resize = new ResizeObserver(() => { if (active) renderer.resize(); }); resize.observe(canvas);
  return {
    renderer,
    setActive(value) {
      const next = Boolean(value) && !disposed;
      if (active === next) return;
      active = next;
      if (!active) { if (frame !== null) cancelAnimationFrame(frame); frame = null; clear(); return; }
      renderer.resize(); if (frame === null) draw();
    },
    dispose() {
      if (disposed) return;
      disposed = true; active = false;
      if (frame !== null) cancelAnimationFrame(frame);
      unsubscribe(); resize.disconnect(); clear();
    },
  };
}

/** Read-only combined output on Midiophilia's two-deck mixer. */
export function mountMixerMonitor(host, { engine }) {
  const visualizer = document.createElement('div'); visualizer.className = 'mixer-performance-visualizer';
  visualizer.innerHTML = `<div class="mixer-performance-toolbar"><label>Picture <select id="mixerPerformanceView"><option value="trails">Note trails</option><option value="radial">Radial</option><option value="ribbons">Ribbons</option><option value="orbit">Orbit</option></select></label><span class="mixer-performance-key">A + B</span></div>
    <canvas id="mixerPerformanceCanvas" aria-label="Combined MIDI notes: pitch runs left to right and time rises from bottom to top">Both decks appear together, colored by voice.</canvas>`;
  host.append(visualizer);
  const monitor = mountMidiPerformanceMonitor(visualizer.querySelector('canvas'), { engine });
  const events = new AbortController(), view = visualizer.querySelector('select');
  view.addEventListener('change', () => monitor.renderer.configure({ view: view.value }), { signal: events.signal });
  return { setActive: monitor.setActive, dispose() { events.abort(); monitor.dispose(); visualizer.remove(); } };
}

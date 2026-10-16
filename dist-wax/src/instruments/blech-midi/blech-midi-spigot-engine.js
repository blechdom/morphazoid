import { parseMidi, MIDI_SAMPLE_LIMITS } from '../midi-mixer/midi-mixer-model.js';
import { rotateMidiStamp, transformMidiStamp } from '../midi-mixer/midi-mixer-score-transform.js';

const clamp = (value, low, high, fallback = low) => Math.max(low, Math.min(high, Number.isFinite(Number(value)) ? Number(value) : fallback));
const PPQ = 480, MAX_SOURCES = 16, MAX_STROKE_NOTES = 4096, STROKE_GRID = 1 / 16;
const copy = value => structuredClone(value);
const vlq = value => { const bytes = [value & 127]; while ((value = Math.floor(value / 128))) bytes.unshift((value & 127) | 128); return bytes; };

/** A bounded appendable score. Input notes are immutable once sent to the clock. */
export function blechStrokeScore(notes, durationBeats, name = 'Drawn stream') {
  if (!notes.length || notes.length > MAX_STROKE_NOTES) throw new Error('A stroke supports 1–4,096 notes.');
  const duration = clamp(durationBeats, 1 / PPQ, MIDI_SAMPLE_LIMITS.beats);
  const events = [{ tick: 0, rank: 0, bytes: [255, 81, 3, 7, 161, 32] }];
  for (const note of notes) {
    const channel = Math.round(clamp(note.channel, 0, 15, 0)), pitch = Math.round(clamp(note.note, 0, 127)), velocity = Math.round(clamp(note.velocity, 1, 127, 88));
    const start = Math.round(clamp(note.beat, 0, duration - 1 / PPQ) * PPQ), end = Math.min(Math.round(duration * PPQ), Math.max(start + 1, Math.round((note.beat + note.duration) * PPQ)));
    events.push({ tick: start, rank: 2, bytes: [144 + channel, pitch, velocity] }, { tick: end, rank: 1, bytes: [128 + channel, pitch, 0] });
  }
  events.push({ tick: Math.round(duration * PPQ), rank: 3, bytes: [255, 47, 0] });
  events.sort((a, b) => a.tick - b.tick || a.rank - b.rank);
  const data = []; let previous = 0;
  for (const event of events) { data.push(...vlq(event.tick - previous), ...event.bytes); previous = event.tick; }
  const bytes = new Uint8Array(22 + data.length), view = new DataView(bytes.buffer);
  bytes.set([77,84,104,100,0,0,0,6,0,0,0,1,1,224,77,84,114,107]); view.setUint32(18, data.length); bytes.set(data, 22);
  const analysis = parseMidi(bytes.buffer);
  return { buffer: bytes.buffer, analysis, notes: analysis.notes, durationBeats: analysis.durationBeats, noteCount: analysis.noteCount, text: name };
}

export function transformBlechSpigot(score, settings = {}) {
  const rotated = rotateMidiStamp(score.buffer, { rotationDegrees: settings.rotationDegrees ?? 0, pitchWidth: settings.widthNotes ?? null, heightBeats: settings.heightBeats ?? null });
  const transpose = Math.round(clamp(settings.transpose ?? 0, -rotated.pitchLow, 127 - rotated.pitchHigh, 0));
  const routed = transformMidiStamp(rotated.buffer, { transpose, channel: settings.channel ?? null });
  return { ...score, ...rotated, ...routed, pitchLow: rotated.pitchLow + routed.appliedTranspose, pitchHigh: rotated.pitchHigh + routed.appliedTranspose, pitchWidth: rotated.pitchWidth, notes: routed.analysis.notes, pixels: undefined, durationBeats: routed.analysis.durationBeats, noteCount: routed.analysis.noteCount };
}

/** Persistent emitter identity is independent of the four audible clip slots.
 * Parameter edits update the running phrase at its retained phase. A closed valve
 * finishes the current pass; opening it later launches the retained source. */
export function createBlechSpigotEngine({ engine, sendScore = (score, settings) => ({ ...score, sampleId: engine.triggerSample(score.buffer, { ...settings, program: settings.program === 'original' ? null : settings.program })?.id }), onChange = () => {}, onTransform = () => {} } = {}) {
  const sources = new Map(), strokes = new Map(); let serial = 0, disposed = false;
  const sampleFor = record => engine.state.samples.find(sample => sample.id === record.sampleId);
  function notify() { onChange(); }
  function launch(record) {
    const settings = record.settings;
    // Pitch/routing are already in these bytes; retain width/height for the
    // existing Text editor's authored-layout resize contract.
    const sent = sendScore(record.score, { ...settings, name: record.name, source: record.source, transpose: 0, authoredTranspose: settings.transpose, sourceRotationDegrees: settings.rotationDegrees, channel: settings.channel, quantize: false });
    if (!sent?.sampleId) return null;
    // The saved-pad sender owns score/patch/gain, but its compact API does not
    // forward every layer mixer option. Restore those on this same new sample.
    const mix = Object.fromEntries(['pan', 'muted', 'solo', 'midi', 'sync', 'hold'].filter(key => settings[key] !== undefined).map(key => [key, settings[key]]));
    if (Object.keys(mix).length) engine.configureSample(sent.sampleId, mix);
    record.sampleId = sent.sampleId; record.lastSample = sampleFor(record); record.pendingEdit = false; return sent;
  }
  function create(sourceScore, settings = {}) {
    if (disposed || !sourceScore?.buffer) return null;
    if (sources.size >= MAX_SOURCES) {
      const idle = [...sources.values()].find(record => !sampleFor(record));
      if (!idle) throw new Error('Close a source before adding another.');
      sources.delete(idle.id);
    }
    const source = copy(sourceScore), record = { id: `spigot-${++serial}`, sampleId: null, sourceScore: source,
      name: String(settings.name || source.text || 'Pattern').slice(0, 128), source: settings.source || 'frames',
      settings: { transpose: 0, delayBeats: 0, widthNotes: null, heightBeats: null, rotationDegrees: 0, gain: .75, channel: 0, program: '0', loop: false, ...settings } };
    record.score = transformBlechSpigot(source, record.settings);
    record.settings.transpose = record.score.appliedTranspose;
    const sent = launch(record); if (!sent) return null;
    sources.set(record.id, record); notify(); return { ...record, ...sent, id: record.id };
  }
  /** Attach a saved-pad replay to the same layer identity without sending MIDI.
   * Its already transformed score becomes a fresh geometric origin. */
  function adoptSample(sampleId, sourceScore = null) {
    if (disposed) return null;
    const existing = bySample(sampleId); if (existing) return existing;
    const audible = engine.getSampleScore(sampleId); if (!audible) return null;
    const sample = engine.state.samples.find(item => item.id === sampleId); if (!sample) return null;
    if (sources.size >= MAX_SOURCES) {
      const idle = [...sources.values()].find(record => !sampleFor(record));
      if (!idle) throw new Error('Close a source before adding another.');
      sources.delete(idle.id);
    }
    const source = { ...(sourceScore ? copy(sourceScore) : {}), ...audible, pixels: undefined };
    const settings = { transpose: 0, delayBeats: sample.delayBeats ?? 0, widthNotes: null, heightBeats: null, rotationDegrees: 0,
      gain: sample.gain, pan: sample.pan, channel: sample.channel, program: sample.midi?.program ?? sample.program ?? 'original',
      midi: copy(sample.midi), loop: sample.loop, sync: sample.sync, muted: sample.muted, solo: sample.solo };
    const record = { id: `spigot-${++serial}`, sampleId, sourceScore: source, name: sample.name, source: sample.source || 'frames',
      settings, score: transformBlechSpigot(source, settings), lastSample: sample, pendingEdit: false, expectedVersion: sample.scoreVersion };
    sources.set(record.id, record); notify(); return record;
  }
  function getLayers() {
    const samples = engine.state.samples;
    return [...sources.values()].map(record => {
      const sample = samples.find(item => item.id === record.sampleId);
      if (!sample) record.pendingEdit = false;
      if (sample) {
        record.lastSample = sample;
        for (const key of ['loop', 'gain', 'pan', 'muted', 'solo', 'channel', 'hold']) record.settings[key] = sample[key];
        if (!sample.pendingReplacement && record.expectedVersion !== undefined && sample.scoreVersion === record.expectedVersion) record.pendingEdit = false;
      }
      return { ...record, ...record.settings, playing: Boolean(sample && !sample.paused), paused: Boolean(sample?.paused), open: Boolean(sample && record.settings.loop), active: Boolean(sample), pendingEdit: Boolean(record.pendingEdit) };
    });
  }
  function edit(id, patch = {}) {
    const record = sources.get(id); if (!record || disposed) return false;
    const settings = { ...record.settings, ...patch }, transformed = transformBlechSpigot(record.sourceScore, settings);
    settings.transpose = transformed.appliedTranspose;
    settings.delayBeats = clamp(settings.delayBeats, 0, 64, 0);
    const sample = sampleFor(record);
    if (sample) {
      const next = engine.replaceSample(sample.id, transformed.buffer, { name: record.name, when: 'live', delayBeats: settings.delayBeats });
      record.expectedVersion = next?.pendingReplacement?.token ?? next?.scoreVersion;
      record.pendingEdit = Boolean(next?.pendingReplacement);
    } else record.pendingEdit = false;
    record.settings = settings; record.score = transformed; onTransform(record); notify(); return record;
  }
  function loop(id, enabled) {
    const record = sources.get(id); if (!record || disposed) return false;
    record.settings.loop = Boolean(enabled); const sample = sampleFor(record);
    if (sample) {
      engine.configureSample(sample.id, { loop: record.settings.loop });
      if (enabled && record.pendingEdit && !sample.paused) edit(id, {});
    } else if (enabled) launch(record);
    notify(); return true;
  }
  function configure(id, patch) {
    const record = sources.get(id); if (!record || disposed) return false;
    record.settings = { ...record.settings, ...patch };
    const sample = sampleFor(record); if (sample) engine.configureSample(sample.id, { ...patch, ...(patch.program === 'original' ? { program: null } : {}) });
    if (patch.channel !== undefined) record.score = transformBlechSpigot(record.sourceScore, record.settings);
    notify(); return true;
  }
  function togglePlay(id) {
    const record = sources.get(id); if (!record || disposed) return false;
    const sample = sampleFor(record);
    if (sample) { engine.setSamplePaused(sample.id, !sample.paused); if (sample.paused && record.pendingEdit && record.settings.loop) edit(id, {}); }
    else launch(record);
    notify(); return true;
  }
  function remove(id) { const record = sources.get(id); if (!record) return false; if (record.sampleId != null) engine.stopSample(record.sampleId); sources.delete(id); strokes.delete(id); notify(); return true; }
  function bySample(id) { return [...sources.values()].find(record => record.sampleId === id) ?? null; }
  function stopAll() { strokes.clear(); for (const record of sources.values()) record.settings.loop = false; engine.stopSamples(); notify(); }
  function forgetSample(id) { const record = bySample(id); if (record) { sources.delete(record.id); strokes.delete(record.id); } }
  function adoptText(id, score) {
    const record = bySample(id); if (!record) return;
    const oldBeats = record.sourceScore.textSettings?.beats, newBeats = score.textSettings?.beats;
    if (oldBeats && newBeats && record.settings.heightBeats != null) record.settings.heightBeats *= newBeats / oldBeats;
    record.sourceScore = copy(score); record.score = transformBlechSpigot(score, record.settings);
    const sample = sampleFor(record); record.pendingEdit = Boolean(sample?.pendingReplacement); record.expectedVersion = sample?.pendingReplacement?.token ?? sample?.scoreVersion; onTransform(record);
  }
  function drawStart(pitch, delayBeats, prepared) {
    const state = engine.state, lead = Math.max(STROKE_GRID, state.tempo / 60 * .1);
    const note = { note: Math.round(clamp(pitch, 0, 127)), channel: 0, velocity: 88, beat: 0, duration: lead * 2 };
    const initialDelay = clamp(delayBeats, 0, 64) + lead;
    const sent = create(blechStrokeScore([note], 512, 'Drawn loop'), {
      ...(prepared?.settings ?? {}), source: 'frames', name: 'Drawn loop', transpose: 0,
      widthNotes: null, heightBeats: null, rotationDegrees: 0, delayBeats: initialDelay, loop: false,
    });
    if (!sent) return null;
    const record = sources.get(sent.id);
    record.stroke = true; record.settings.delayBeats = clamp(delayBeats, 0, 64);
    strokes.set(record.id, { kind: 'draw', notes: [note], origin: state.sampleBeat, initialDelay, initialPointDelay: clamp(delayBeats, 0, 64),
      pitch: note.note, pointBeat: 0, lastEnd: note.duration, moved: false, loop: true });
    record.score = blechStrokeScore([note], note.duration, record.name); notify(); return record.id;
  }
  function drawMove(id, point, finishing = false) {
    const stroke = strokes.get(id), record = sources.get(id), state = engine.state;
    const sample = record && state.samples.find(item => item.id === record.sampleId);
    if (!stroke || !sample || sample.paused) return false;
    const elapsed = Math.max(0, state.sampleBeat - stroke.origin), pitch = Math.round(clamp(point.pitch, 0, 127));
    const delay = clamp(point.delayBeats, 0, 64), lead = Math.max(STROKE_GRID, state.tempo / 60 * .1);
    const at = Math.max(stroke.pointBeat, elapsed + delay - stroke.initialPointDelay);
    const notes = stroke.notes.map(note => ({ ...note })), current = notes.at(-1), span = Math.abs(pitch - stroke.pitch);
    const late = !sample.pendingBeats && current.beat + current.duration < sample.positionBeats;
    if (late || span) {
      const steps = late ? 1 : span, from = late ? at : Math.max(stroke.pointBeat, sample.pendingBeats ? 0 : sample.positionBeats + 1 / PPQ);
      const step = Math.max(1 / PPQ, (at - from) / Math.max(1, steps));
      if (notes.length + steps > MAX_STROKE_NOTES || at > 510) return brushEnd(id);
      for (let i = 1; i <= steps; i++) {
        const beat = Math.max(notes.at(-1).beat + 1 / PPQ, late ? at : from + step * (i - .5));
        if (!late || i > 1) notes.at(-1).duration = Math.max(1 / PPQ, beat - notes.at(-1).beat);
        notes.push({ note: late ? pitch : stroke.pitch + Math.sign(pitch - stroke.pitch) * i, channel: 0, velocity: 88,
          beat, duration: Math.max(1 / PPQ, at + lead * 2 - beat) });
      }
    } else current.duration = Math.max(1 / PPQ, at + (finishing ? 0 : lead * 2) - current.beat);
    const score = blechStrokeScore(notes, 512, record.name);
    if (!engine.appendSample(record.sampleId, score.buffer, { allowGateEdits: true })) return false;
    stroke.notes = notes; stroke.pitch = pitch; stroke.pointBeat = at; stroke.moved ||= Boolean(span) || Math.abs(delay - stroke.initialPointDelay) > .01;
    stroke.lastEnd = Math.max(...notes.map(note => note.beat + note.duration));
    record.sourceScore = score; record.score = blechStrokeScore(notes, stroke.lastEnd, record.name); notify(); return true;
  }
  function drawEnd(id, { cancelled = false } = {}) {
    const stroke = strokes.get(id), record = sources.get(id); if (!stroke || !record) return false;
    const state = engine.state, sample = state.samples.find(item => item.id === record.sampleId);
    const elapsed = Math.max(0, state.sampleBeat - stroke.origin), notes = stroke.notes.map(note => ({ ...note }));
    const last = notes.at(-1), shortest = !stroke.moved && elapsed < .25 && Boolean(sample?.pendingBeats);
    const end = Math.max(STROKE_GRID, shortest ? STROKE_GRID : Math.round(Math.max(elapsed, stroke.pointBeat) / STROKE_GRID) * STROKE_GRID,
      last.beat + 1 / PPQ, sample?.positionBeats ? sample.positionBeats + 1 / PPQ : 0);
    last.duration = Math.max(1 / PPQ, end - last.beat);
    const score = blechStrokeScore(notes, Math.min(512, end), record.name);
    if (sample) engine.appendSample(record.sampleId, score.buffer, { allowGateEdits: true });
    strokes.delete(id); record.stroke = false; record.sourceScore = score; record.score = score;
    if (!cancelled) loop(id, true);
    notify(); return true;
  }
  function erasePoint(id, point) {
    const stroke = strokes.get(id), record = sources.get(id);
    if (!stroke || stroke.kind !== 'erase' || !record) return false;
    const beat = Number(point.delayBeats ?? 0) - (record.settings.delayBeats ?? 0), pitch = Math.round(point.pitch);
    const from = stroke.point ?? { pitch, beat }, distance = Math.max(Math.abs(pitch - from.pitch), Math.ceil(Math.abs(beat - from.beat) / .125), 1);
    const points = Array.from({ length: Math.min(2048, distance + 1) }, (_, i) => ({ pitch: from.pitch + (pitch - from.pitch) * i / Math.max(1, distance), beat: from.beat + (beat - from.beat) * i / Math.max(1, distance) }));
    const notes = stroke.notes.filter(note => !points.some(hit => Math.abs(note.note - hit.pitch) <= 1 && hit.beat + .125 >= note.beat && hit.beat - .125 <= note.beat + note.duration));
    stroke.point = { pitch, beat }; if (notes.length === stroke.notes.length) return false;
    stroke.notes = notes;
    if (!notes.length) { remove(id); return true; }
    const retained = new Set(notes.map(note => note.id));
    const filtered = transformMidiStamp(stroke.original.buffer, { removeNoteIds: stroke.original.analysis.notes.filter(note => !retained.has(note.id)).map(note => note.id) });
    const score = { ...stroke.original, ...filtered, notes: filtered.analysis.notes, durationBeats: filtered.analysis.durationBeats, noteCount: filtered.analysis.noteCount, pixels: undefined }, sample = sampleFor(record);
    if (sample) engine.replaceSample(sample.id, score.buffer, { name: record.name, when: 'live', delayBeats: record.settings.delayBeats });
    record.sourceScore = score; record.score = score;
    record.settings = { ...record.settings, transpose: 0, widthNotes: null, heightBeats: null, rotationDegrees: 0 };
    onTransform(record); notify(); return true;
  }
  function brushStart({ mode = 'draw', pitch = 60, delayBeats = 0, prepared, sourceId } = {}) {
    if (disposed) return null;
    if (mode === 'draw') return drawStart(pitch, delayBeats, prepared);
    if (mode === 'erase') {
      const record = sources.get(sourceId); if (!record) throw new Error('Select a layer to erase its notes.');
      strokes.set(sourceId, { kind: 'erase', notes: copy(record.score.analysis.notes), original: copy(record.score) });
      erasePoint(sourceId, { pitch, delayBeats }); return sourceId;
    }
    const settings = { ...(prepared?.settings ?? {}), source: 'frames', name: mode === 'stamp' ? `${prepared?.settings?.name || 'Stamp'} stream` : 'Drawn stream', delayBeats: 0, transpose: 0, widthNotes: null, heightBeats: null, rotationDegrees: 0, loop: false };
    const shape = mode === 'stamp' && prepared?.score ? transformBlechSpigot(prepared.score, prepared.settings) : null;
    if (mode === 'stamp' && !shape) throw new Error('Choose a shape before painting stamps.');
    if (shape && (shape.analysis.notes.length > MAX_STROKE_NOTES || shape.analysis.durationBeats > 511 || shape.analysis.notes.some(note => note.channel > 15))) {
      // Large/full MIDI artwork remains placeable with all events and metadata.
      // It owns one source; this gesture cannot multiply it into a brush stream.
      const center = (shape.pitchLow + shape.pitchHigh) / 2;
      return create(prepared.score, { ...prepared.settings, transpose: (prepared.settings.transpose ?? 0) + Math.round(pitch - center),
        delayBeats: clamp(delayBeats, 0, 64), quantize: false })?.id ?? null;
    }
    const state = engine.state, lead = Math.max(.125, state.tempo / 60 * .06), start = Math.min(500, clamp(delayBeats, 0, 64) + lead);
    settings.delayBeats = start;
    const points = brushNotes(shape, pitch, 0);
    if (!points.length) throw new Error('Shorten this stamp before painting a stream.');
    const score = blechStrokeScore(points, 512, settings.name), sent = create(score, settings); if (!sent) return null;
    const record = sources.get(sent.id); record.stroke = true;
    record.settings.delayBeats = clamp(delayBeats, 0, 64);
    const stroke = { id: sent.id, notes: points, shape, pitch: Math.round(pitch), origin: state.sampleBeat, initialDelay: start, last: 0, interval: shape ? Math.max(.25, Math.min(4, shape.analysis.durationBeats)) : .125,
      loop: Boolean(prepared?.settings?.loop), lastEnd: Math.max(...points.map(note => note.beat + note.duration)) };
    strokes.set(record.id, stroke); record.score = blechStrokeScore(points, stroke.lastEnd, record.name); notify(); return record.id;
  }
  function brushNotes(shape, pitch, start, previousPitch = pitch) {
    const center = shape ? (Math.min(...shape.analysis.notes.map(note => note.note)) + Math.max(...shape.analysis.notes.map(note => note.note))) / 2 : pitch;
    if (shape) {
      const low = Math.min(...shape.analysis.notes.map(note => note.note)), high = Math.max(...shape.analysis.notes.map(note => note.note));
      const transpose = Math.round(clamp(pitch - center, -low, 127 - high));
      if (start + shape.analysis.durationBeats > 511) return [];
      return shape.analysis.notes.map(note => ({ note: note.note + transpose, channel: note.channel, velocity: note.velocity, beat: start + note.beat, duration: note.duration }));
    }
    const from = Math.round(clamp(previousPitch, 0, 127)), to = Math.round(clamp(pitch, 0, 127));
    return Array.from({ length: Math.abs(to - from) + 1 }, (_, index) => ({ note: from + Math.sign(to - from) * index, channel: 0, velocity: 88, beat: start, duration: .125 }));
  }
  function brushMove(id, { pitch, delayBeats = 0 } = {}) {
    const stroke = strokes.get(id), record = sources.get(id); if (!stroke || !record || disposed) return false;
    if (stroke.kind === 'draw') return drawMove(id, { pitch, delayBeats });
    if (stroke.kind === 'erase') return erasePoint(id, { pitch, delayBeats });
    const state = engine.state, sample = state.samples.find(item => item.id === record.sampleId); if (!sample || sample.paused) return false;
    const elapsed = Math.max(0, state.sampleBeat - stroke.origin);
    if (elapsed - stroke.last < stroke.interval - 1e-9) return false;
    const lead = Math.max(.125, state.tempo / 60 * .06), at = Math.max(0, Math.ceil((elapsed + lead - stroke.initialDelay) * 8) / 8 + clamp(delayBeats, 0, 64));
    if (at >= 510 || stroke.notes.length >= MAX_STROKE_NOTES) { brushEnd(id); return false; }
    const extra = brushNotes(stroke.shape, pitch, at, stroke.pitch);
    if (!extra.length || extra.length + stroke.notes.length > MAX_STROKE_NOTES) { brushEnd(id); return false; }
    const next = [...stroke.notes, ...extra], score = blechStrokeScore(next, 512, record.name);
    const appended = engine.appendSample(record.sampleId, score.buffer); if (!appended) return false;
    stroke.notes = next; stroke.last = elapsed; stroke.pitch = Math.round(pitch); stroke.lastEnd = Math.max(stroke.lastEnd, ...extra.map(note => note.beat + note.duration));
    record.sourceScore = score; record.score = blechStrokeScore(next, stroke.lastEnd, record.name); notify(); return true;
  }
  function brushEnd(id, { cancelled = false } = {}) {
    const stroke = strokes.get(id), record = sources.get(id); if (!stroke || !record) return false;
    if (stroke.kind === 'draw') return drawEnd(id, { cancelled });
    if (stroke.kind === 'erase') { strokes.delete(id); notify(); return true; }
    strokes.delete(id); record.stroke = false;
    const sample = sampleFor(record), duration = Math.min(512, Math.max(stroke.lastEnd, (sample?.positionBeats ?? 0) + .125));
    const score = blechStrokeScore(stroke.notes, duration, record.name);
    if (sample) engine.appendSample(record.sampleId, score.buffer);
    record.sourceScore = score; record.score = score;
    if (stroke.loop && !cancelled) loop(id, true);
    notify(); return true;
  }
  return { create, adoptSample, edit, configure, loop, togglePlay, remove, bySample, forgetSample, adoptText, stopAll, getLayers, brushStart, brushMove, brushEnd,
    dispose() { disposed = true; strokes.clear(); sources.clear(); } };
}

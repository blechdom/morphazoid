import { parseMidi, MIDI_SAMPLE_LIMITS } from '../midi-mixer/midi-mixer-model.js';
import { rotateMidiStamp, transformMidiStamp } from '../midi-mixer/midi-mixer-score-transform.js';

const clamp = (value, low, high, fallback = low) => Math.max(low, Math.min(high, Number.isFinite(Number(value)) ? Number(value) : fallback));
const PPQ = 480, MAX_SOURCES = 16, MAX_STROKE_NOTES = 4096, STROKE_GRID = 1 / 16, MAX_HISTORY_SECONDS = 12;
const copy = value => structuredClone(value);
const vlq = value => { const bytes = [value & 127]; while ((value = Math.floor(value / 128))) bytes.unshift((value & 127) | 128); return bytes; };
export const brushPitches = (pitch, size = 1) => {
  const center = Math.round(clamp(pitch, 0, 127)), width = Math.round(clamp(size, 1, 8, 1));
  return Array.from({ length: width }, (_, index) => center + index - Math.floor((width - 1) / 2)).filter(note => note >= 0 && note <= 127);
};

/** A nib paints MIDI pitch/time cells, not an image or an audio-rate effect.
 * Every spray cell is deterministic, so repeated previews and saved scores
 * have the same holes without depending on rendering or random state.
 */
export function blechBrushImprint(pitch, beat, { size = 1, height = 1, nib = 'square', velocity = 88 } = {}) {
  const pitches = brushPitches(pitch, size), rows = Math.round(clamp(height, 1, 8, 1)), start = clamp(beat, 0, 510);
  const strength = Math.round(clamp(velocity, 1, 127, 88)), cells = [], middle = (pitches[0] + pitches.at(-1)) / 2;
  const noteAt = (note, row, length) => ({ note, beat: start + row * STROKE_GRID, duration: length * STROKE_GRID,
    channel: 0, velocity: strength });
  for (const note of pitches) {
    if (nib === 'spray') {
      for (let row = 0; row < rows; row++) {
        const seed = (Math.imul(note + 1, 73856093) ^ Math.imul(Math.round(start * PPQ) + row * 30 + 1, 19349663)) >>> 0;
        if (seed % 11 < 2) cells.push(noteAt(note, row, 1));
      }
    } else {
      const distance = pitches.length === 1 ? 0 : (note - middle) / (pitches.length / 2);
      const length = nib === 'circle' ? Math.max(1, Math.round(rows * Math.sqrt(1 - distance * distance))) : rows;
      cells.push(noteAt(note, Math.floor((rows - length) / 2), length));
    }
  }
  if (!cells.length) cells.push(noteAt(Math.round(clamp(pitch, 0, 127)), 0, 1));
  return cells;
}

/** Rasterize a drag in the pitch/time plane. Occupied sixteenth-beat cells
 * coalesce into note gates per pitch, so even a full solid rectangle is
 * bounded by 128 notes rather than thousands of repeated attacks.
 */
export function blechGeometryNotes(tool, start, end, brush = {}, fill = 'outline', maxBeats = 64) {
  if (!['line', 'rectangle', 'ellipse', 'triangle'].includes(tool)) return [];
  // A line is a connected series of clicked anchors. Rasterize its segments
  // into the same cells before coalescing, so corners have one gate and one
  // one-shot sound instead of retriggering at every intersection.
  const vertices = tool === 'line' && Array.isArray(start) ? start : [start, end];
  if (vertices.length < 2 || vertices.some(point => !point)) return [];
  [start, end] = [vertices[0], vertices.at(-1)];
  const limit = clamp(maxBeats, STROKE_GRID, 512, 64);
  const row = point => Math.round(clamp(point.delayBeats, 0, limit) / STROKE_GRID);
  const x0 = Math.round(clamp(start.pitch, 0, 127)), x1 = Math.round(clamp(end.pitch, 0, 127));
  const y0 = row(start), y1 = row(end), left = Math.min(x0, x1), right = Math.max(x0, x1);
  const bottom = Math.min(y0, y1), top = Math.max(y0, y1);
  const rowCount = Math.ceil(limit / STROKE_GRID) + 8; // Room for a tall nib at the last row.
  const columns = new Map(), thickness = Math.round(clamp(brush.height ?? 1, 1, 8, 1));
  const velocity = Math.round(clamp(brush.velocity ?? 88, 1, 127, 88));
  function mark(pitch, first, last) {
    if (pitch < 0 || pitch > 127 || last < 0 || first >= rowCount) return;
    let column = columns.get(pitch);
    if (!column) { column = { cells: new Uint8Array(rowCount), first: rowCount, last: -1 }; columns.set(pitch, column); }
    first = Math.max(0, first); last = Math.min(rowCount - 1, last);
    column.cells.fill(1, first, last + 1);
    column.first = Math.min(column.first, first); column.last = Math.max(column.last, last);
  }
  function outline(pitch, beatRow) {
    for (const note of blechBrushImprint(pitch, beatRow * STROKE_GRID, brush)) {
      const first = Math.round(note.beat / STROKE_GRID);
      mark(note.note, first, first + Math.round(note.duration / STROKE_GRID) - 1);
    }
  }
  function solid(pitch, first, last) {
    for (const note of brushPitches(pitch, brush.size)) mark(note, first, last + thickness - 1);
  }
  function edge(ax, ay, bx, by) {
    const steps = Math.max(Math.abs(bx - ax), Math.abs(by - ay));
    for (let step = 0; step <= steps; step++) {
      const part = steps ? step / steps : 0;
      outline(Math.round(ax + (bx - ax) * part), Math.round(ay + (by - ay) * part));
    }
  }
  if (tool === 'line') for (let index = 1; index < vertices.length; index++)
    edge(Math.round(clamp(vertices[index - 1].pitch, 0, 127)), row(vertices[index - 1]),
      Math.round(clamp(vertices[index].pitch, 0, 127)), row(vertices[index]));
  else if (left === right && bottom === top) edge(x0, y0, x1, y1);
  else if (tool === 'rectangle') {
    if (fill === 'solid') for (let x = left; x <= right; x++) solid(x, bottom, top);
    else {
      edge(left, bottom, right, bottom); edge(right, bottom, right, top);
      edge(right, top, left, top); edge(left, top, left, bottom);
    }
  } else if (tool === 'ellipse') {
    if (left === right || bottom === top) edge(left, bottom, right, top);
    else if (fill === 'solid') {
      const cx = (left + right) / 2, cy = (bottom + top) / 2, rx = (right - left) / 2, ry = (top - bottom) / 2;
      for (let x = left; x <= right; x++) {
        const extent = ry * Math.sqrt(Math.max(0, 1 - ((x - cx) / rx) ** 2));
        const first = Math.ceil(cy - extent), last = Math.floor(cy + extent);
        solid(x, first <= last ? first : Math.round(cy), first <= last ? last : Math.round(cy));
      }
    } else {
      const cx = (left + right) / 2, cy = (bottom + top) / 2, rx = (right - left) / 2, ry = (top - bottom) / 2;
      const steps = Math.ceil(2 * Math.PI * Math.max(rx, ry));
      let lastX = right, lastY = Math.round(cy);
      for (let step = 1; step <= steps; step++) {
        const angle = step * 2 * Math.PI / steps;
        const x = Math.round(cx + rx * Math.cos(angle)), y = Math.round(cy + ry * Math.sin(angle));
        edge(lastX, lastY, x, y); lastX = x; lastY = y;
      }
    }
  } else {
    const peak = Math.round((left + right) / 2);
    if (left === right || bottom === top) edge(left, bottom, right, top);
    else if (fill === 'solid') for (let x = left; x <= right; x++) {
      const fraction = x <= peak ? (x - left) / Math.max(1, peak - left) : (right - x) / Math.max(1, right - peak);
      solid(x, bottom, Math.round(bottom + (top - bottom) * fraction));
    }
    else { edge(left, bottom, peak, top); edge(peak, top, right, bottom); edge(right, bottom, left, bottom); }
  }
  const notes = [];
  for (const [pitch, { cells, first, last }] of columns) for (let index = first; index <= last;) {
    if (!cells[index]) { index++; continue; }
    const beginning = index++;
    while (index <= last && cells[index]) index++;
    notes.push({ note: pitch, beat: beginning * STROKE_GRID, duration: (index - beginning) * STROKE_GRID,
      velocity, channel: 0 });
    if (notes.length > MAX_STROKE_NOTES) throw new Error('Shape is too detailed. Use a smaller brush or shape.');
  }
  return notes.sort((a, b) => a.beat - b.beat || a.note - b.note);
}

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

/** A rail tap loops one gated note; a double-click uses the engine's held
 * voice instead of repeatedly attacking a very long MIDI note. */
export function blechRailNoteScore(pitch, periodBeats = .25, held = false) {
  const period = held ? 1 : clamp(periodBeats, .25, 8, .25);
  return blechStrokeScore([{ note: Math.round(clamp(pitch, 0, 127, 60)),
    channel: 0, velocity: 88, beat: 0, duration: held ? 1 : period / 2 }],
  period, held ? 'Held rail note' : 'Repeating rail note');
}

/** A picture on the future plane: horizontal distance is pitch, vertical
 * distance is time. Unlike Free Draw, drawing speed does not set this loop.
 * Interpolating both axes prevents fast pointer movement from leaving holes.
 */
export function loopDrawingNotes(points, brush = {}) {
  if (!points.length) return null;
  const cells = new Map();
  function add(point) {
    const pitch = Math.round(clamp(point.pitch, 0, 127)), delay = Math.round(clamp(point.delayBeats, 0, 64) / STROKE_GRID) * STROKE_GRID;
    for (const note of blechBrushImprint(pitch, delay, { velocity: 84, ...brush })) {
      if (cells.size >= MAX_STROKE_NOTES) break;
      cells.set(`${note.note}:${Math.round(note.beat * PPQ)}`, note);
    }
  }
  add(points[0]);
  for (let index = 1; index < points.length && cells.size < MAX_STROKE_NOTES; index++) {
    const from = points[index - 1], to = points[index];
    const steps = Math.min(MAX_STROKE_NOTES, Math.max(1, Math.ceil(Math.abs(to.pitch - from.pitch)), Math.ceil(Math.abs(to.delayBeats - from.delayBeats) / STROKE_GRID)));
    for (let part = 1; part <= steps && cells.size < MAX_STROKE_NOTES; part++)
      add({ pitch: from.pitch + (to.pitch - from.pitch) * part / steps, delayBeats: from.delayBeats + (to.delayBeats - from.delayBeats) * part / steps });
  }
  return normalizeDrawingNotes([...cells.values()]);
}

function normalizeDrawingNotes(selected) {
  if (!selected.length) return null;
  const first = Math.min(...selected.map(note => note.beat));
  const last = Math.max(...selected.map(note => note.beat + note.duration));
  const durationBeats = Math.max(1, last - first);
  return { delayBeats: first, durationBeats, notes: selected.map(note => ({
    ...note, beat: note.beat - first, duration: Math.min(note.duration, durationBeats - (note.beat - first)),
  })).sort((a, b) => a.beat - b.beat || a.note - b.note) };
}

export function loopDrawingScore(points, brush = {}) {
  const drawing = loopDrawingNotes(points, brush);
  return drawing ? { ...drawing, score: blechStrokeScore(drawing.notes, drawing.durationBeats, 'Loop drawing') } : null;
}

export function blechGeometryDrawing(tool, start, end, brush = {}, fill = 'outline') {
  const inkNotes = blechGeometryNotes(tool, start, end, brush, fill);
  const drawing = normalizeDrawingNotes(inkNotes);
  if (!drawing) return null;
  const name = { line: 'Line', rectangle: 'Rectangle', ellipse: 'Ellipse', triangle: 'Triangle' }[tool];
  return { ...drawing, inkNotes, name, score: blechStrokeScore(drawing.notes, drawing.durationBeats, name) };
}

/** An always-on, bounded *performed* note window. Forecasts and seeks are not
 * heard notes. Keeping it separate from visual trails lets a performer catch a
 * phrase after it passes, even when the past display is switched off.
 */
export function createBlechLoopCatch() {
  const heard = new Map();
  let previousTime = -Infinity;
  function record({ now, live = [], file = [] }) {
    if (!Number.isFinite(now)) return;
    if (now < previousTime - .01) heard.clear();
    previousTime = now;
    for (const note of [...live.slice(-MAX_STROKE_NOTES), ...file.slice(-MAX_STROKE_NOTES)]) {
      if (!note.id || !Number.isInteger(note.pitch) || note.pitch < 0 || note.pitch > 127 ||
        !Number.isFinite(note.start) || !Number.isFinite(note.end) || note.start > 0 || note.end <= note.start) continue;
      const start = now + note.start, end = now + Math.min(note.end, 0);
      const previous = heard.get(note.id);
      if (previous) previous.end = Math.max(previous.end, end);
      else heard.set(note.id, { note: note.pitch, channel: clamp(Math.round(note.channel ?? 0), 0, 15),
        velocity: clamp(Math.round(note.velocity ?? 88), 1, 127), start, end });
    }
    for (const [id, note] of heard) if (note.end < now - MAX_HISTORY_SECONDS) heard.delete(id);
    while (heard.size > MAX_STROKE_NOTES) heard.delete(heard.keys().next().value);
  }
  function capture(now, bpm, beats = 4) {
    const tempo = clamp(Number(bpm) || 120, 30, 4800), duration = clamp(Number(beats) || 4, 1, 16);
    const from = now - duration * 60 / tempo;
    const notes = [...heard.values()].filter(note => note.end > from && note.start < now)
      .sort((a, b) => a.start - b.start || a.note - b.note).slice(-MAX_STROKE_NOTES)
      .map(note => ({ note: note.note, channel: note.channel, velocity: note.velocity,
        beat: Math.max(0, note.start - from) * tempo / 60,
        duration: (Math.min(now, note.end) - Math.max(from, note.start)) * tempo / 60 }))
      .filter(note => note.duration >= 1 / PPQ);
    if (!notes.length) return null;
    return blechStrokeScore(notes, duration, `Caught · last ${duration} beats`);
  }
  return { record, capture, clear() { heard.clear(); previousTime = -Infinity; }, get size() { return heard.size; } };
}

export function transformBlechSpigot(score, settings = {}) {
  const rotated = rotateMidiStamp(score.buffer, { rotationDegrees: settings.rotationDegrees ?? 0, pitchWidth: settings.widthNotes ?? null, pitchRange: score.pitchRange, heightBeats: settings.heightBeats ?? null });
  const transpose = Math.round(clamp(settings.transpose ?? 0, -rotated.pitchLow, 127 - rotated.pitchHigh, 0));
  const routed = transformMidiStamp(rotated.buffer, { transpose, channel: settings.channel ?? null });
  return { ...score, ...rotated, ...routed, pitchLow: rotated.pitchLow + routed.appliedTranspose, pitchHigh: rotated.pitchHigh + routed.appliedTranspose, pitchWidth: rotated.pitchWidth, notes: routed.analysis.notes, pixels: undefined, durationBeats: routed.analysis.durationBeats, noteCount: routed.analysis.noteCount };
}

// Live gestures use the sample clock, but are not editable/saved layers.
// Their records exist only while the notes can still sound (or a stroke is
// being drawn); the four clip slots and the persistent layer limit are separate.
const LIVE_SOURCES = new Set(['free-draw', 'rail', 'comb', 'crossing']);
export const isBlechLiveSource = source => LIVE_SOURCES.has(source);

/** Persistent emitter identity is independent of the four audible clip slots.
 * Parameter edits update the running phrase at its retained phase. A closed valve
 * finishes the current pass; opening it later launches the retained source. */
export function createBlechSpigotEngine({ engine, sendScore = (score, settings) => ({ ...score, sampleId: engine.triggerSample(score.buffer, { ...settings, program: settings.program === 'original' ? null : settings.program })?.id }), onChange = () => {}, onTransform = () => {} } = {}) {
  const sources = new Map(), live = new Map(), strokes = new Map(); let serial = 0, disposed = false;
  const recordFor = id => sources.get(id) ?? live.get(id);
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
    const ephemeral = isBlechLiveSource(settings.source);
    if (!ephemeral && sources.size >= MAX_SOURCES) {
      throw new Error('16 layers maximum. Remove a layer or use Trash before adding more.');
    }
    const source = copy(sourceScore), record = { id: `spigot-${++serial}`, sampleId: null, sourceScore: source,
      name: String(settings.name || source.text || 'Pattern').slice(0, 128), source: settings.source || 'frames',
      settings: { transpose: 0, delayBeats: 0, widthNotes: null, heightBeats: null, rotationDegrees: 0, gain: .75, channel: 0, program: '0', loop: false, ...settings,
        ...(ephemeral ? { saveToPads: false } : {}) } };
    record.score = transformBlechSpigot(source, record.settings);
    record.settings.transpose = record.score.appliedTranspose;
    const sent = launch(record); if (!sent) return null;
    (ephemeral ? live : sources).set(record.id, record);
    notify(); return { ...record, ...sent, id: record.id };
  }
  /** Attach a saved-pad replay to the same layer identity without sending MIDI.
   * Its already transformed score becomes a fresh geometric origin. */
  function adoptSample(sampleId, sourceScore = null) {
    if (disposed) return null;
    const existing = bySample(sampleId); if (existing) return existing;
    const audible = engine.getSampleScore(sampleId); if (!audible) return null;
    const sample = engine.state.samples.find(item => item.id === sampleId); if (!sample) return null;
    if (isBlechLiveSource(sample.source)) return null;
    if (sources.size >= MAX_SOURCES) {
      throw new Error('16 layers maximum. Remove a layer or use Trash before adding more.');
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
  function getLiveSources() {
    const samples = new Map(engine.state.samples.map(sample => [sample.id, sample]));
    for (const [id, record] of live) if (!samples.has(record.sampleId) && !strokes.has(id)) live.delete(id);
    return [...live.values()].flatMap(record => {
      const sample = samples.get(record.sampleId);
      return sample ? [{ ...record, ...record.settings, playing: !sample.paused, paused: sample.paused,
        active: true, lastSample: sample }] : [];
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
    record.settings = settings; record.score = transformed;
    onTransform(record); notify(); return record;
  }
  function loop(id, enabled) {
    const record = sources.get(id); if (!record || disposed) return false;
    // The Comb is a one-shot. Only the upper corner owns the repeating
    // crossing; do not let frame or layer-loop controls make either latch.
    if (record.source === 'comb' || record.source === 'crossing') return false;
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
  function remove(id) { const record = recordFor(id); if (!record) return false; if (record.sampleId != null) engine.stopSample(record.sampleId); sources.delete(id); live.delete(id); strokes.delete(id); notify(); return true; }
  function bySample(id) { return [...sources.values()].find(record => record.sampleId === id) ?? null; }
  function stopAll() { strokes.clear(); live.clear(); for (const record of sources.values()) record.settings.loop = false; engine.stopSamples(); notify(); }
  function clearAll() { strokes.clear(); sources.clear(); live.clear(); engine.stopSamples(); notify(); }
  function forgetSample(id) { const record = bySample(id) ?? [...live.values()].find(item => item.sampleId === id); if (record) { sources.delete(record.id); live.delete(record.id); strokes.delete(record.id); } }
  function adoptText(id, score) {
    const record = bySample(id); if (!record) return;
    const oldBeats = record.sourceScore.textSettings?.beats, newBeats = score.textSettings?.beats;
    if (oldBeats && newBeats && record.settings.heightBeats != null) record.settings.heightBeats *= newBeats / oldBeats;
    record.sourceScore = copy(score); record.score = transformBlechSpigot(score, record.settings);
    const sample = sampleFor(record); record.pendingEdit = Boolean(sample?.pendingReplacement); record.expectedVersion = sample?.pendingReplacement?.token ?? sample?.scoreVersion; onTransform(record);
  }
  function drawStart(pitch, delayBeats, prepared, brush = {}, repeatBeats = 0) {
    const state = engine.state, lead = Math.max(STROKE_GRID, state.tempo / 60 * .1);
    const repeat = repeatBeats ? clamp(repeatBeats, STROKE_GRID, 4) : 0;
    const firstDelay = clamp(delayBeats, 0, 64);
    const notes = blechBrushImprint(pitch, firstDelay, brush).map(mark => ({
      ...mark, minDuration: brush.height > 1 ? mark.duration : 1 / PPQ,
      duration: repeat ? Math.min(mark.duration, repeat / 2) : Math.max(mark.duration, lead * 2),
    }));
    // Start the clock at the gesture, not at its first note. A later stroke can
    // then travel *below* that note in the future plane without going backward
    // in a playing sample's timebase.
    const sent = create(blechStrokeScore(notes, 512, repeat ? 'Free draw · repeat' : 'Free draw'), {
      ...(prepared?.settings ?? {}), source: 'free-draw', name: repeat ? 'Free draw · repeat' : 'Free draw', transpose: 0,
      widthNotes: null, heightBeats: null, rotationDegrees: 0, delayBeats: lead, loop: false,
    });
    if (!sent) return null;
    const record = live.get(sent.id);
    record.stroke = true; record.freeDraw = true; record.settings.delayBeats = 0;
    strokes.set(record.id, { kind: 'draw', notes, groupSize: notes.length, brush, origin: state.sampleBeat, lastDelay: firstDelay,
      pitch: Math.round(clamp(pitch, 0, 127)), pointBeat: firstDelay, lastEnd: Math.max(...notes.map(note => note.beat + note.duration)), moved: false,
      repeatBeats: repeat, nextRepeatBeat: firstDelay + repeat });
    record.score = { ...record.score, analysis: { ...record.score.analysis, durationBeats: strokes.get(record.id).lastEnd },
      durationBeats: strokes.get(record.id).lastEnd }; notify(); return record.id;
  }
  function drawGeometry(drawing, prepared) {
    if (disposed || !drawing?.score?.buffer) return null;
    const lead = Math.max(STROKE_GRID, engine.state.tempo / 60 * .1);
    const name = `Free draw · ${drawing.name}`;
    const sent = create(drawing.score, { ...(prepared?.settings ?? {}), source: 'free-draw', name,
      transpose: 0, widthNotes: null, heightBeats: null, rotationDegrees: 0,
      delayBeats: clamp(drawing.delayBeats + lead, 0, 64), loop: false, hold: false });
    if (!sent) return null;
    const record = live.get(sent.id);
    record.freeDraw = true;
    notify(); return record.id;
  }
  function drawMove(id, points) {
    const stroke = strokes.get(id), record = recordFor(id), state = engine.state;
    if (!stroke || !record) return false;
    const path = Array.isArray(points) ? points : [points];
    if (!path.length) return false;
    const sample = record && state.samples.find(item => item.id === record.sampleId);
    if (!sample || sample.paused) return false;
    const elapsed = Math.max(0, state.sampleBeat - stroke.origin), lead = Math.max(STROKE_GRID, state.tempo / 60 * .1);
    const floor = sample.pendingBeats ? 0 : sample.positionBeats + 1 / PPQ;
    const pointTime = point => Number.isFinite(point?.elapsedMilliseconds)
      ? Math.min(elapsed, Math.max(0, point.elapsedMilliseconds) * state.tempo / 60000) : elapsed;
    const position = point => ({ pitch: Math.round(clamp(point.pitch, 0, 127)), delay: clamp(point.delayBeats, 0, 64),
      at: Math.max(floor, pointTime(point) + clamp(point.delayBeats, 0, 64)) });
    if (stroke.repeatBeats) {
      let { pitch, pointBeat, lastDelay, nextRepeatBeat, groupSize } = stroke;
      const extra = [];
      const occupied = new Set(stroke.notes.map(note => `${note.note}:${Math.round(note.beat * PPQ)}`));
      function pushGroup(center, at) {
        let tick = Math.round(at * PPQ);
        let marks = blechBrushImprint(center, tick / PPQ, stroke.brush);
        if (stroke.notes.length + extra.length + marks.length > MAX_STROKE_NOTES) return false;
        while (tick < 510 * PPQ && marks.some(mark => occupied.has(`${mark.note}:${Math.round(mark.beat * PPQ)}`))) {
          tick++; marks = blechBrushImprint(center, tick / PPQ, stroke.brush);
        }
        if (tick >= 510 * PPQ || stroke.notes.length + extra.length + marks.length > MAX_STROKE_NOTES) return false;
        for (const mark of marks) {
          occupied.add(`${mark.note}:${Math.round(mark.beat * PPQ)}`);
          extra.push({ ...mark, duration: Math.min(mark.duration, stroke.repeatBeats / 2) });
        }
        groupSize = marks.length;
        return true;
      }
      for (const raw of path) {
        const point = position(raw), span = Math.abs(point.pitch - pitch);
        if (span) {
          const first = Math.max(point.at + lead, floor);
          for (let i = 1; i <= span; i++) {
            const beat = first + (i - 1) / PPQ;
            if (!pushGroup(pitch + Math.sign(point.pitch - pitch) * i, beat)) break;
          }
          nextRepeatBeat = first + (span - 1) / PPQ + stroke.repeatBeats;
        } else while (nextRepeatBeat <= point.at + lead && nextRepeatBeat < 510) {
          if (!pushGroup(point.pitch, Math.max(nextRepeatBeat, floor))) break;
          nextRepeatBeat += stroke.repeatBeats;
        }
        pitch = point.pitch; lastDelay = point.delay; pointBeat = point.at;
      }
      stroke.pitch = pitch; stroke.pointBeat = pointBeat; stroke.lastDelay = lastDelay; stroke.nextRepeatBeat = nextRepeatBeat;
      if (!extra.length) return false;
      const notes = [...stroke.notes, ...extra], score = blechStrokeScore(notes, 512, record.name);
      if (!engine.appendSample(record.sampleId, score.buffer)) return false;
      stroke.notes = notes; stroke.groupSize = groupSize;
      stroke.lastEnd = Math.max(stroke.lastEnd, ...extra.map(note => note.beat + note.duration));
      record.sourceScore = score; record.score = { ...score, analysis: { ...score.analysis, durationBeats: stroke.lastEnd },
        durationBeats: stroke.lastEnd }; notify(); return true;
    }
    const notes = stroke.notes.slice();
    let { pitch, pointBeat, lastDelay, groupSize } = stroke, changed = false, moved = false, lastEnd = stroke.lastEnd;
    // One MIDI re-encode per pointermove, even if Chromium coalesced a sharp
    // zigzag into dozens of samples. Interpolate *both* axes for each segment;
    // new future attacks may precede an older, still-pending attack.
    const occupied = new Set(notes.map(note => `${note.note}:${Math.round(note.beat * PPQ)}`));
    const floorTick = Math.ceil(floor * PPQ);
    for (const raw of path) {
      const point = position(raw), span = Math.abs(point.pitch - pitch);
      const steps = Math.max(span, Math.ceil(Math.abs(point.delay - lastDelay) / .25));
      const descending = point.delay < lastDelay && point.at < pointBeat;
      let lastTick = Math.round(notes.at(-groupSize).beat * PPQ);
      if (steps) moved = true;
      for (let part = 1; part <= steps && point.at < 510; part++) {
        const center = Math.round(pitch + (point.pitch - pitch) * part / steps);
        let tick = Math.round(Math.max(floor, pointBeat + (point.at - pointBeat) * part / steps) * PPQ);
        // MIDI cannot encode a curved path at sub-tick resolution. Keep even
        // same-frame horizontal moves successive (not a 128-note chord), but
        // permit time to descend at sharp turns that head toward the keys.
        tick = descending && lastTick > floorTick ? Math.max(floorTick, Math.min(tick, lastTick - 1)) : Math.max(tick, lastTick + 1);
        let direction = descending ? -1 : 1;
        let marks = blechBrushImprint(center, tick / PPQ, stroke.brush);
        if (notes.length + marks.length > MAX_STROKE_NOTES) break;
        while (tick < 510 * PPQ && marks.some(mark => occupied.has(`${mark.note}:${Math.round(mark.beat * PPQ)}`))) {
          if (tick <= floorTick) direction = 1;
          tick += direction;
          marks = blechBrushImprint(center, tick / PPQ, stroke.brush);
        }
        const beat = tick / PPQ;
        if (beat >= 510 || notes.length + marks.length > MAX_STROKE_NOTES) break;
        const previous = notes.at(-groupSize);
        if (beat >= previous.beat && (sample.pendingBeats || previous.beat + previous.duration >= sample.positionBeats)) for (let index = notes.length - groupSize; index < notes.length; index++) {
          const prior = notes[index], duration = Math.max(prior.minDuration ?? STROKE_GRID, beat - prior.beat);
          if (duration !== prior.duration) { notes[index] = { ...prior, duration }; changed = true; }
        }
        for (const mark of marks) {
          occupied.add(`${mark.note}:${Math.round(mark.beat * PPQ)}`);
          notes.push({ ...mark, minDuration: stroke.brush.height > 1 ? mark.duration : 1 / PPQ,
            duration: Math.max(mark.duration, lead * 2) });
        }
        groupSize = marks.length; lastTick = tick;
        lastEnd = Math.max(lastEnd, ...notes.slice(-groupSize).map(note => note.beat + note.duration)); changed = true;
      }
      pitch = point.pitch; lastDelay = point.delay; pointBeat = point.at;
    }
    const current = notes.at(-groupSize), at = Math.max(floor, elapsed + lastDelay);
    const late = !sample.pendingBeats && current.beat + current.duration < sample.positionBeats;
    if (late && at < 510) {
      const beat = Math.max(at, notes.at(-1).beat + 1 / PPQ);
      const group = blechBrushImprint(pitch, beat, stroke.brush).map(mark => ({
        ...mark, minDuration: stroke.brush.height > 1 ? mark.duration : 1 / PPQ,
        duration: Math.max(mark.duration, lead * 2),
      }));
      if (notes.length + group.length <= MAX_STROKE_NOTES) {
        notes.push(...group); groupSize = group.length; changed = true;
        lastEnd = Math.max(lastEnd, ...group.map(note => note.beat + note.duration));
      }
    } else if (!moved && notes.length === stroke.notes.length && at < 510 && current.beat + current.duration < at + lead * 1.5) {
      for (let index = notes.length - groupSize; index < notes.length; index++) {
        const prior = notes[index], duration = Math.max(prior.minDuration ?? STROKE_GRID, at + lead * 2 - prior.beat);
        if (duration !== prior.duration) { notes[index] = { ...prior, duration }; changed = true; lastEnd = Math.max(lastEnd, prior.beat + duration); }
      }
    }
    if (!changed) { stroke.pitch = pitch; stroke.lastDelay = lastDelay; stroke.pointBeat = pointBeat; stroke.moved ||= moved; return false; }
    const score = blechStrokeScore(notes, 512, record.name);
    if (!engine.appendSample(record.sampleId, score.buffer, { allowGateEdits: true })) return false;
    stroke.notes = notes; stroke.groupSize = groupSize; stroke.pitch = pitch; stroke.pointBeat = pointBeat; stroke.lastDelay = lastDelay;
    stroke.moved ||= moved; stroke.lastEnd = lastEnd;
    record.sourceScore = score; record.score = { ...score, analysis: { ...score.analysis, durationBeats: stroke.lastEnd },
      durationBeats: stroke.lastEnd }; notify(); return true;
  }
  function drawEnd(id, { cancelled = false } = {}) {
    const stroke = strokes.get(id), record = recordFor(id); if (!stroke || !record) return false;
    const state = engine.state, sample = state.samples.find(item => item.id === record.sampleId);
    const elapsed = Math.max(0, state.sampleBeat - stroke.origin), notes = stroke.notes.map(note => ({ ...note }));
    const last = notes.at(-stroke.groupSize), shortest = !stroke.moved && elapsed < .25 && Boolean(sample?.pendingBeats);
    const end = stroke.repeatBeats
      ? Math.max(STROKE_GRID, stroke.lastEnd, sample?.positionBeats ? sample.positionBeats + 1 / PPQ : 0)
      : Math.max(STROKE_GRID, shortest ? last.beat + STROKE_GRID
        : Math.round(Math.max(last.beat, elapsed + stroke.lastDelay) / STROKE_GRID) * STROKE_GRID,
        last.beat + (stroke.moved ? STROKE_GRID : 1 / PPQ), sample?.positionBeats ? sample.positionBeats + 1 / PPQ : 0);
    if (!stroke.repeatBeats) for (const note of notes.slice(-stroke.groupSize))
      note.duration = Math.max(note.minDuration ?? STROKE_GRID, end - note.beat);
    const duration = Math.min(512, Math.max(end, ...notes.map(note => note.beat + note.duration)));
    const score = blechStrokeScore(notes, duration, record.name);
    if (sample) engine.appendSample(record.sampleId, score.buffer, { allowGateEdits: true });
    strokes.delete(id); record.stroke = false; record.sourceScore = score; record.score = score;
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
  function brushStart({ mode = 'draw', pitch = 60, delayBeats = 0, prepared, sourceId, size = 1, height = 1, nib = 'square', velocity = 88, repeatBeats = 0 } = {}) {
    if (disposed) return null;
    if (mode === 'draw') return drawStart(pitch, delayBeats, prepared, { size, height, nib, velocity }, repeatBeats);
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
  function brushMove(id, point = {}) {
    const stroke = strokes.get(id), record = recordFor(id); if (!stroke || !record || disposed) return false;
    if (stroke.kind === 'draw') return drawMove(id, point);
    const { pitch, delayBeats = 0 } = point;
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
    const stroke = strokes.get(id), record = recordFor(id); if (!stroke || !record) return false;
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
  return { create, adoptSample, edit, configure, loop, togglePlay, remove, bySample, forgetSample, adoptText, stopAll, clearAll, getLayers, getLiveSources, drawGeometry, brushStart, brushMove, brushEnd,
    dispose() { disposed = true; strokes.clear(); sources.clear(); live.clear(); } };
}

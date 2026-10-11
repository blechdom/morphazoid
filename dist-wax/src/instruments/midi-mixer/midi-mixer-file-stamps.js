import { parseMidi, clamp, modulo, beatsToSeconds, MIDI_SAMPLE_LIMITS } from './midi-mixer-model.js';

// Prepared analyses are immutable. A WeakMap lets the UI bound its own file cache.
const preparedScores = new WeakMap();
const parameterCC = new Set([6, 38, 96, 97, 98, 99, 100, 101]);
const sorted = events => events.sort((a, b) => a.beat - b.beat || a.order - b.order);

function prepare(analysis) {
  if (preparedScores.has(analysis)) return preparedScores.get(analysis);
  const notes = analysis.notes.map(note => ({ ...note, keyEnd: note.beat + note.duration, soundingEnd: note.beat + note.duration, offOrder: note.id + 0.5 }));
  const byId = new Map(notes.map(note => [note.id, note])), channels = new Map();
  const release = (held, beat) => { for (const note of held) note.soundingEnd = Math.max(note.beat + 1 / analysis.ppq, beat); held.clear(); };
  for (const event of analysis.events) {
    let state = channels.get(event.channel);
    if (!state) { state = { pedal: false, active: new Set(), held: new Set() }; channels.set(event.channel, state); }
    const note = byId.get(event.noteId);
    if (event.kind === 9 && note) state.active.add(note);
    else if (event.kind === 8 && note) {
      note.offOrder = event.order;
      if (state.active.delete(note) && state.pedal) { state.held.add(note); note.soundingEnd = analysis.durationBeats; }
    } else if (event.kind === 11) {
      if (event.a === 64 || event.a === 121) {
        state.pedal = event.a === 64 && event.b >= 64;
        if (!state.pedal) release(state.held, event.beat);
      } else if (event.a === 120 || event.a === 123) {
        for (const held of state.active) {
          held.keyEnd = Math.min(held.keyEnd, event.beat);
          held.soundingEnd = Math.max(held.beat + 1 / analysis.ppq, event.beat);
          if (event.a === 123 && state.pedal) { state.held.add(held); held.soundingEnd = analysis.durationBeats; }
        }
        state.active.clear();
        if (event.a === 120) release(state.held, event.beat);
      }
    }
  }
  const firstBeat = notes[0].beat, lastBeat = notes.reduce((end, note) => Math.max(end, note.soundingEnd), firstBeat + 1 / analysis.ppq);
  const prepared = { notes, firstBeat, lastBeat };
  preparedScores.set(analysis, prepared); return prepared;
}

function denseStart(notes, length, bar, lastBeat) {
  const lastStart = Math.max(0, Math.floor((lastBeat - length) / bar) * bar);
  const candidates = new Set([0, lastStart]);
  for (const note of notes) {
    candidates.add(clamp(Math.floor(note.beat / bar) * bar, 0, lastStart));
    candidates.add(clamp((Math.floor((note.beat - length) / bar) + 1) * bar, 0, lastStart));
  }
  let low = 0, high = 0, bestCount = -1, best = 0;
  for (const start of [...candidates].sort((a, b) => a - b)) {
    while (low < notes.length && notes[low].beat < start) low++;
    high = Math.max(low, high);
    while (high < notes.length && notes[high].beat < start + length) high++;
    if (high - low > bestCount) { best = start; bestCount = high - low; }
  }
  return best;
}

/** Reconstruct channel state without replaying thousands of historical bends.
 * RPN/NRPN data retains its selector and program changes retain their bank.
 * Relative parameter increments retain their complete parameter history.
 */
function historyAt(analysis, start, wanted) {
  const states = new Map([...wanted].map(channel => [channel, { latest: new Map(), bank: new Map(), selectors: new Map(), mode: 'rpn', parameters: new Map(), parameterHistory: [], relative: false }]));
  for (const event of analysis.events) {
    if (event.beat >= start) break;
    const state = states.get(event.channel);
    if (!state || event.kind === 8 || event.kind === 9) continue;
    if (event.kind === 11 && parameterCC.has(event.a)) {
      state.parameterHistory.push(event);
      if ([98, 99, 100, 101].includes(event.a)) {
        state.selectors.set(event.a, event);
        state.mode = event.a === 98 || event.a === 99 ? 'nrpn' : 'rpn';
        state.latest.set(`cc:${event.a}`, event);
      } else {
        if (event.a === 96 || event.a === 97) state.relative = true;
        const msb = state.mode === 'rpn' ? 101 : 99, lsb = state.mode === 'rpn' ? 100 : 98;
        const selectors = [msb, lsb].map(a => state.selectors.get(a) ?? { ...event, a, b: 127 });
        const key = `${state.mode}:${selectors[0].b}:${selectors[1].b}:${event.a}`;
        state.parameters.set(key, { event, selectors });
      }
    } else {
      const key = `${event.kind}:${event.kind === 11 || event.kind === 10 ? event.a : 0}`;
      state.latest.set(key, event);
      if (event.kind === 11 && (event.a === 0 || event.a === 32)) state.bank.set(event.a, event);
      if (event.kind === 12) state.programBank = [...state.bank.values()].map(bank => ({ ...bank, beat: event.beat, order: event.order - (bank.a === 0 ? 0.2 : 0.1) }));
    }
  }
  const output = [];
  for (const state of states.values()) {
    for (const event of state.latest.values()) {
      if (state.relative && event.kind === 11 && parameterCC.has(event.a)) continue;
      output.push(event);
    }
    if (state.programBank) output.push(...state.programBank);
    if (state.relative) output.push(...state.parameterHistory);
    else for (const { event, selectors } of state.parameters.values()) {
      output.push(...selectors.map((selector, index) => ({ ...selector, beat: event.beat, order: event.order - 0.2 + index * 0.1 })), event);
    }
  }
  // Collapse chronological history only after ordering across all source tracks.
  return sorted(output).map((event, index) => ({ ...event, beat: 0, order: index - output.length - 1 }));
}

function vlq(value) {
  const bytes = [value & 127];
  while ((value = Math.floor(value / 128))) bytes.unshift((value & 127) | 128);
  return bytes;
}
function chunk(id, bytes) {
  const size = bytes.length;
  return [...id].map(char => char.charCodeAt(0)).concat([size >>> 24, (size >>> 16) & 255, (size >>> 8) & 255, size & 255], bytes);
}
function encode(events, ppq, duration, meter, tempoMap) {
  const tracks = [], endTick = Math.max(1, Math.round(duration * ppq));
  const meta = [0, 255, 88, 4, meter.numerator, Math.log2(meter.denominator), 24, 8];
  let previousTempoTick = 0;
  for (const tempo of tempoMap) {
    const tick = Math.min(endTick, Math.max(previousTempoTick, Math.round(tempo.beat * ppq)));
    const micros = Math.round(clamp(60000000 / tempo.bpm, 1, 0xffffff, 500000));
    meta.push(...vlq(tick - previousTempoTick), 255, 81, 3, micros >>> 16, (micros >>> 8) & 255, micros & 255);
    previousTempoTick = tick;
  }
  meta.push(...vlq(endTick - previousTempoTick), 255, 47, 0);
  tracks.push(chunk('MTrk', meta));
  const channels = new Map();
  for (const event of events) {
    if (!channels.has(event.channel)) channels.set(event.channel, []);
    channels.get(event.channel).push(event);
  }
  for (const [channel, channelEvents] of channels) {
    const bytes = [0, 255, 33, 1, Math.floor(channel / 16)]; let previous = 0;
    for (const event of sorted(channelEvents)) {
      const tick = Math.min(endTick, Math.max(previous, Math.round(event.beat * ppq)));
      bytes.push(...vlq(tick - previous), event.kind * 16 + channel % 16, event.a);
      if (event.kind !== 12 && event.kind !== 13) bytes.push(event.b);
      previous = tick;
    }
    bytes.push(...vlq(endTick - previous), 255, 47, 0); tracks.push(chunk('MTrk', bytes));
  }
  const header = chunk('MThd', [0, 1, 0, tracks.length, ppq >>> 8, ppq & 255]);
  const output = new Uint8Array(header.length + tracks.reduce((sum, track) => sum + track.length, 0));
  output.set(header); let offset = header.length;
  for (const track of tracks) { output.set(track, offset); offset += track.length; }
  return output.buffer;
}

function excerpt(analysis, prepared, start, end, outputBeats, transpose) {
  const selected = prepared.notes.filter(note => note.beat < end && note.soundingEnd > start);
  const used = new Set(selected.map(note => note.channel));
  if (selected.length > MIDI_SAMPLE_LIMITS.notes || used.size > MIDI_SAMPLE_LIMITS.channels) return null;
  if (!selected.length) throw new Error('This slice contains no notes. Choose another slice.');
  let low = 127, high = 0, pitched = false;
  for (const note of selected) if (note.channel % 16 !== 9) { low = Math.min(low, note.note); high = Math.max(high, note.note); pitched = true; }
  const effectiveTranspose = pitched ? clamp(transpose, -low, 127 - high) : 0;
  const shift = (note, channel) => channel % 16 === 9 ? note : clamp(note + effectiveTranspose, 0, 127);
  const scale = outputBeats / (end - start), events = historyAt(analysis, start, used);
  const ppq = Math.max(960, analysis.ppq), endTick = Math.max(1, Math.round(outputBeats * ppq));
  for (const event of events) if (event.kind === 10) event.a = shift(event.a, event.channel);
  let restoredNoteCount = 0, sustainedNoteCount = 0;
  for (const [index, note] of selected.entries()) {
    const restored = note.beat < start;
    if (restored) restoredNoteCount++;
    if (note.keyEnd < start) sustainedNoteCount++;
    const onTick = Math.min(endTick - 1, Math.round(Math.max(0, note.beat - start) * scale * ppq));
    const on = onTick / ppq;
    // Restored attacks follow state restoration and precede in-range controls.
    const onOrder = restored ? -0.9 + index / (selected.length + 1) * 0.4 : note.id;
    const off = Math.max(0, Math.max(note.beat, Math.min(end, note.keyEnd)) - start) * scale;
    const offTick = restored && note.keyEnd <= start ? 0 : Math.min(endTick, Math.max(onTick + 1, Math.round(off * ppq)));
    events.push({ beat: on, order: onOrder, channel: note.channel, kind: 9, a: shift(note.note, note.channel), b: note.velocity });
    events.push({ beat: offTick / ppq, order: restored && note.keyEnd <= start ? onOrder + 0.0000001 : note.offOrder, channel: note.channel, kind: 8, a: shift(note.note, note.channel), b: 0 });
  }
  for (const event of analysis.events) {
    if (event.beat >= end) break;
    if (event.beat < start || !used.has(event.channel) || event.kind === 8 || event.kind === 9) continue;
    events.push({ ...event, beat: (event.beat - start) * scale, a: event.kind === 10 ? shift(event.a, event.channel) : event.a });
  }
  for (const channel of used) {
    events.push({ beat: outputBeats, order: Infinity, channel, kind: 11, a: 64, b: 0 });
    events.push({ beat: outputBeats, order: Infinity, channel, kind: 11, a: 123, b: 0 });
  }
  // Tempo is state: an excerpt starts with the BPM already in effect, then
  // follows its source changes. Length fitting scales their positions with
  // the notes while retaining each BPM for unsynced playback.
  const tempoMap = [{ beat: 0, bpm: analysis.tempoMap.findLast(item => item.beat <= start)?.bpm ?? 120 }];
  for (const tempo of analysis.tempoMap) {
    if (tempo.beat >= end) break;
    if (tempo.beat > start) tempoMap.push({ beat: (tempo.beat - start) * scale, bpm: tempo.bpm });
  }
  if (events.length + tempoMap.length > MIDI_SAMPLE_LIMITS.events) return null;
  const meter = analysis.meterMap.findLast(item => item.beat <= start) ?? analysis.meterMap[0];
  const buffer = encode(events, ppq, outputBeats, meter, tempoMap);
  if (buffer.byteLength > MIDI_SAMPLE_LIMITS.fileBytes) return null;
  return { buffer, noteCount: selected.length, channelCount: used.size, restoredNoteCount, sustainedNoteCount, effectiveTranspose, scale };
}

/** Create a self-contained one-shot without dropping individual source notes.
 * `whole` trims empty margins; `fitBeats` scales that entire picture uniformly.
 * Long files use a dense bar-aligned window, then adjoining slices via variant.
 * If a window exceeds sample bounds, only its end moves; metadata discloses it.
 */
export function createMidiFileStamp(input, options = {}) {
  const analysis = input?.notes && input?.events ? input : parseMidi(input);
  const prepared = prepare(analysis), whole = Boolean(options.whole);
  const meter = analysis.meterMap[0], bar = meter.numerator * 4 / meter.denominator;
  const requestedBeats = clamp(options.beats ?? clamp(options.bars ?? 1, 1, 4) * bar, 1 / 32, MIDI_SAMPLE_LIMITS.beats, bar);
  const fitBeats = whole && options.fitBeats != null ? clamp(options.fitBeats, 1 / 32, MIDI_SAMPLE_LIMITS.beats, requestedBeats) : null;
  const requestedTranspose = Math.round(clamp(options.transpose ?? 0, -36, 36));
  const variant = Math.floor(clamp(options.variant ?? 0, 0, 1000000));
  let start = whole ? prepared.firstBeat : options.startBeat == null
    ? modulo(denseStart(prepared.notes, requestedBeats, bar, prepared.lastBeat) + variant * requestedBeats, prepared.lastBeat)
    : clamp(options.startBeat, 0, Math.max(0, prepared.lastBeat - 1 / analysis.ppq));
  start = Math.floor(start * analysis.ppq + 1e-7) / analysis.ppq;
  let skippedRest = false;
  if (!whole && !prepared.notes.some(note => note.beat < start + requestedBeats && note.soundingEnd > start)) {
    // Next Slice must advance across a silent interlude instead of retrying it.
    start = (prepared.notes.find(note => note.beat >= start + requestedBeats) ?? prepared.notes[0]).beat;
    skippedRest = true;
  }
  const requestedEnd = whole ? prepared.lastBeat : Math.min(prepared.lastBeat, start + requestedBeats);
  let end = requestedEnd, result, shortened = false;
  // Temporal reduction is explicit; even a single simultaneous group is never thinned.
  for (let attempt = 0; attempt < 24; attempt++) {
    const duration = fitBeats ?? end - start;
    result = duration <= MIDI_SAMPLE_LIMITS.beats ? excerpt(analysis, prepared, start, end, duration, requestedTranspose) : null;
    if (result) break;
    shortened = true;
    const ticks = Math.floor((end - start) * analysis.ppq / 2);
    if (ticks < 1) break;
    end = start + ticks / analysis.ppq;
  }
  if (!result) throw new Error('This instant is too dense for a complete MIDI stamp. Choose a different start; no notes were removed.');
  const stampAnalysis = parseMidi(result.buffer), warnings = [...(analysis.warnings ?? [])];
  if (skippedRest) warnings.push('Skipped an empty passage to the next note. The source range shows the actual excerpt.');
  if (shortened) warnings.push('The excerpt was shortened to fit one-shot limits; every note in the retained time window is preserved.');
  if (result.effectiveTranspose !== requestedTranspose) warnings.push(`Pitch shift limited to ${result.effectiveTranspose} semitones to preserve the complete note range.`);
  const name = String(options.name ?? 'MIDI file').slice(0, 128);
  return { ...result, analysis: stampAnalysis, sourceStartBeat: start, sourceEndBeat: end, sourceStartSeconds: beatsToSeconds(start, analysis.tempoMap), sourceEndSeconds: beatsToSeconds(end, analysis.tempoMap), durationBeats: stampAnalysis.durationBeats,
    requestedBeats: fitBeats ?? requestedBeats, requestedTranspose, shortened, warnings, whole, nextStartBeat: end >= prepared.lastBeat - 1 / analysis.ppq ? 0 : end,
    label: `${name} · ${result.noteCount.toLocaleString('en-US')} notes · beats ${start.toFixed(2)}–${end.toFixed(2)}` };
}

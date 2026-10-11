import { parseMidi, MIDI_MIXER_LIMITS } from './midi-mixer-model.js';

// State, rather than MIDI message order, is reversed. MIDI Association references:
// https://midi.org/midi-1-0-control-change-messages (CC/RPN assignments)
// https://midi.org/response-to-reset-all-controllers (RP-015)
// https://midi.org/response-to-data-increment-decrement-controllers (RP-018)
// This is note/parameter reversal, not waveform or synthesizer-envelope reversal.
const PARAMETER_CC = new Set([6, 38, 96, 97, 98, 99, 100, 101]);
const HOLD_CC = new Set([64, 66]);
const KEEP_ON_RESET = cc => [0, 7, 10, 32].includes(cc) || cc >= 70 && cc <= 79 || cc >= 91 && cc <= 95;
const DEFAULT_CC = new Map([[1, 0], [7, 100], [8, 64], [10, 64], [11, 127], [64, 0], [65, 0], [66, 0], [67, 0], [68, 0], [69, 0]]);
const DEFAULT_RPN = new Map([[0, 2 * 128], [1, 8192], [2, 8192]]);
const bytesOf = input => input instanceof ArrayBuffer ? new Uint8Array(input) : ArrayBuffer.isView(input)
  ? new Uint8Array(input.buffer, input.byteOffset, input.byteLength) : null;
const ordered = (a, b) => a.tick - b.tick || a.order - b.order;
const same = (a, b) => Array.isArray(a) ? a.length === b?.length && a.every((value, i) => value === b[i]) : a === b;
const vlq = value => { const bytes = [value & 127]; while ((value = Math.floor(value / 128))) bytes.unshift((value & 127) | 128); return bytes; };
const textBytes = text => [...new TextEncoder().encode(text)];
const metaBytes = (type, data) => [255, type, ...vlq(data.length), ...data];

/** Read metadata only after parseMidi has validated the SMF. Channel events and
 * FIFO note matching still have a single owner: parseMidi.
 */
function sourceMetadata(bytes, analysis) {
  if (!bytes) return { metadata: [], sysex: 0 };
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength), metadata = [];
  let cursor = 8 + view.getUint32(4), sequence = 0, sysex = 0;
  const readVlq = () => { let value = 0, byte; do { byte = bytes[cursor++]; value = value * 128 + (byte & 127); } while (byte & 128); return value; };
  for (let track = 0; track < analysis.trackCount; track++) {
    const end = cursor + 8 + view.getUint32(cursor + 4); cursor += 8;
    let tick = 0, running = 0;
    while (cursor < end) {
      tick += readVlq(); sequence++;
      let status = bytes[cursor]; if (status < 128) status = running; else cursor++;
      if (status === 255) {
        running = 0; const type = bytes[cursor++], size = readVlq(), data = [...bytes.subarray(cursor, cursor + size)]; cursor += size;
        if (type === 47) { cursor = end; break; }
        if (![0x21, 0x51, 0x58, 0x59].includes(type)) metadata.push({ tick, track, order: sequence, type, data });
      } else if (status === 240 || status === 247) { running = 0; const size = readVlq(); cursor += size; sysex++; }
      else { running = status; cursor += status >> 4 === 12 || status >> 4 === 13 ? 1 : 2; }
    }
  }
  return { metadata, sysex };
}

/** Source key and sounding gates in integer MIDI ticks, for reverse and chase. */
export function getMidiNoteGates(analysis, { sustain = true, onWarning = () => {} } = {}) {
  const warn = onWarning;
  const ppq = analysis.ppq, endTick = Math.round(analysis.durationBeats * ppq);
  const notes = analysis.notes.map(note => ({ ...note, start: Math.round(note.beat * ppq), keyEnd: Math.min(endTick, Math.round((note.beat + note.duration) * ppq)), end: Math.min(endTick, Math.round((note.beat + note.duration) * ppq)), releaseVelocity: 0 }));
  const byId = new Map(notes.map(note => [note.id, note])), states = new Map();
  for (const channel of analysis.channels) states.set(channel.channel, { sustain: false, sostenuto: false, active: new Set(), held: new Set(), latched: new Set() });
  const held = (state, note) => state.sustain || state.sostenuto && state.latched.has(note);
  const close = (state, note, tick) => { note.end = Math.max(note.start + 1, tick); state.held.delete(note); state.latched.delete(note); };
  const release = (state, tick) => { for (const note of state.held) if (!held(state, note)) close(state, note, tick); };
  let baked = false;
  for (const event of analysis.events) {
    const note = byId.get(event.noteId), state = states.get(event.channel), tick = Math.round(event.beat * ppq);
    if (event.kind === 8 && note) { note.releaseVelocity = event.b; note.keyEnd = Math.min(note.keyEnd, tick); }
    if (!sustain || !state) continue;
    if (event.kind === 9 && note) state.active.add(note);
    else if (event.kind === 8 && note && state.active.delete(note)) {
      if (held(state, note)) { state.held.add(note); note.end = endTick; baked = true; }
      else close(state, note, tick);
    } else if (event.kind === 11) {
      if (event.a === 64) { state.sustain = event.b >= 64; release(state, tick); }
      else if (event.a === 66) {
        if (event.b >= 64 && !state.sostenuto) for (const active of state.active) state.latched.add(active);
        state.sostenuto = event.b >= 64; if (!state.sostenuto) state.latched.clear(); release(state, tick);
      } else if (event.a === 121) { state.sustain = state.sostenuto = false; state.latched.clear(); release(state, tick); }
      else if (event.a === 120 || event.a >= 123) {
        for (const active of state.active) {
          active.keyEnd = Math.min(active.keyEnd, tick);
          if (event.a !== 120 && held(state, active)) { state.held.add(active); active.end = endTick; baked = true; }
          else close(state, active, tick);
        }
        state.active.clear();
        if (event.a === 120) { for (const sustained of state.held) close(state, sustained, tick); state.latched.clear(); }
      }
    }
  }
  if (baked) warn('Sustain and sostenuto holds were written as note lengths; pedal messages are off in the reversed MIDI.');
  return notes;
}

function noteIntervals(analysis, mode, warn) {
  const endTick = Math.round(analysis.durationBeats * analysis.ppq);
  const notes = getMidiNoteGates(analysis, { sustain: mode === 'controllers', onWarning: warn });
  const groups = new Map();
  for (const note of notes) {
    const oldStart = note.start; note.start = Math.max(0, endTick - note.end); note.end = Math.max(note.start + 1, endTick - oldStart);
    const key = note.channel * 128 + note.note; if (!groups.has(key)) groups.set(key, []); groups.get(key).push(note);
  }
  let changedOverlap = false, changedTrack = false;
  for (const group of groups.values()) {
    group.sort((a, b) => a.start - b.start || a.end - b.end || b.id - a.id);
    // MIDI 1.0 cannot identify one of several overlapping same-pitch voices.
    // Preserve attacks and use the parser/engine's FIFO release convention.
    const ends = group.map(note => note.end).sort((a, b) => a - b);
    for (let i = 0; i < group.length; i++) { if (group[i].end !== ends[i]) changedOverlap = true; group[i].end = ends[i]; group[i].reverseOrder = i; }
    for (let start = 0; start < group.length;) {
      let end = start + 1; while (end < group.length && group[end].start === group[start].start) end++;
      if (end - start > 1) {
        let track = group[start].track; for (let i = start + 1; i < end; i++) track = Math.min(track, group[i].track);
        for (let i = start; i < end; i++) { if (group[i].track !== track) changedTrack = true; group[i].track = track; }
      }
      start = end;
    }
  }
  if (changedOverlap) warn('Overlapping same-pitch pedal voices use FIFO releases. Every attack remains, but MIDI 1.0 cannot preserve their individual held lengths.');
  if (changedTrack) warn('Simultaneous same-pitch notes from multiple tracks were grouped together to preserve release order.');
  return notes;
}

/** Compact, selector-aware source parameter lanes shared by reverse and chase.
 * Only values known from MIDI or the browser player's starting setup are assumed.
 */
export function buildMidiStateHistories(analysis, { onWarning = () => {} } = {}) {
  const warn = onWarning;
  const channels = new Map(), ppq = analysis.ppq, span = Math.round(analysis.durationBeats * ppq);
  for (const channel of analysis.channels) channels.set(channel.channel, { lanes: new Map(), bank: [0, 0], rpn: [127, 127], nrpn: [127, 127], registered: true, first: null });
  const lane = (state, key, initial, kind, number) => {
    if (!state.lanes.has(key)) state.lanes.set(key, { key, initial, current: initial, kind, number, assumedInitial: initial === undefined, changes: [] });
    return state.lanes.get(key);
  };
  const set = (state, key, initial, kind, number, value, event) => {
    const target = lane(state, key, initial, kind, number), tick = Math.round(event.beat * ppq);
    if (target.current === undefined) {
      target.initial = value;
      if (tick > 0) warn('Some device-specific controller defaults are unknown. Their first explicit value is retained before the first recorded change.');
    }
    // Re-selecting an unchanged selector still changes which parameter family
    // subsequent data addresses, so its chronological position matters to chase.
    if (!same(target.current, value) || kind.endsWith('-selector')) target.changes.push({ tick, order: event.order, value, previous: target.current ?? value });
    target.current = value; return target;
  };
  for (const [channel, state] of channels) {
    lane(state, 'patch', [0, 0, 0], 'patch');
    lane(state, 'bank', [0, 0], 'bank');
    lane(state, 'rpn-selector', [127, 127], 'rpn-selector'); lane(state, 'nrpn-selector', [127, 127], 'nrpn-selector');
    for (const [cc, value] of DEFAULT_CC) lane(state, `cc:${cc}`, cc < 32 ? value * 128 : value, cc < 32 ? 'cc14' : 'cc', cc);
    lane(state, 'bend', 8192, 'bend'); lane(state, 'pressure', 0, 'pressure');
  }
  for (const event of analysis.events) {
    const state = channels.get(event.channel); if (!state) continue;
    const tick = Math.round(event.beat * ppq); if (tick >= span) continue; // terminal cleanup has no positive-duration state
    if (event.kind === 9) { state.first ??= { tick, order: event.order }; continue; }
    if (event.kind === 12) { set(state, 'patch', [0, 0, 0], 'patch', null, [...state.bank, event.a], event); continue; }
    if (event.kind === 14) { set(state, 'bend', 8192, 'bend', null, event.a + event.b * 128, event); continue; }
    if (event.kind === 13) { set(state, 'pressure', 0, 'pressure', null, event.a, event); continue; }
    if (event.kind === 10) { set(state, `poly:${event.a}`, 0, 'poly', event.a, event.b, event); continue; }
    if (event.kind !== 11) continue;
    const cc = event.a, value = event.b;
    if (cc === 0 || cc === 32) { state.bank[cc === 0 ? 0 : 1] = value; set(state, 'bank', [0, 0], 'bank', null, [...state.bank], event); continue; }
    if (cc === 121) {
      // RP-015 resets selectors, performance controllers and pressure; patch,
      // volume, pan, sound/effect controls and parameter values survive.
      state.rpn = [127, 127]; state.nrpn = [127, 127]; state.registered = true;
      set(state, 'rpn-selector', [127, 127], 'rpn-selector', null, [127, 127], event);
      set(state, 'nrpn-selector', [127, 127], 'nrpn-selector', null, [127, 127], event);
      for (const target of state.lanes.values()) {
        let reset;
        if (target.kind === 'bend') reset = 8192;
        else if (target.kind === 'pressure' || target.kind === 'poly') reset = 0;
        else if ((target.kind === 'cc' || target.kind === 'cc14') && !KEEP_ON_RESET(target.number)) reset = target.number === 11 ? 127 * 128 : 0;
        if (reset !== undefined) set(state, target.key, target.initial, target.kind, target.number, reset, event);
      }
      continue;
    }
    if (cc >= 120 || cc === 84 || cc === 88 || cc === 69) {
      if (![120, 123].includes(cc)) warn('Device-specific channel modes, Hold 2, portamento triggers and high-resolution velocity prefixes are not reversed.');
      continue;
    }
    if (PARAMETER_CC.has(cc)) {
      if (cc >= 98) {
        const registered = cc >= 100, selector = registered ? state.rpn : state.nrpn; selector[cc % 2 ? 0 : 1] = value; state.registered = registered;
        const kind = registered ? 'rpn-selector' : 'nrpn-selector'; set(state, kind, [127, 127], kind, null, [...selector], event); continue;
      }
      const registered = state.registered, selector = registered ? state.rpn : state.nrpn, number = selector[0] * 128 + selector[1];
      if (number === 16383) { warn('Unselected parameter data was ignored; no RPN or NRPN target was specified.'); continue; }
      const key = `${registered ? 'rpn' : 'nrpn'}:${number}`, initial = registered ? DEFAULT_RPN.get(number) : undefined;
      const target = lane(state, key, initial, registered ? 'rpn' : 'nrpn', number);
      let next;
      if (cc === 6) next = value * 128 + ((target.current ?? 0) & 127);
      else if (cc === 38) next = ((target.current ?? 0) & 16256) + value;
      else if (!registered || target.current === undefined) { warn('Relative changes to device-specific or uninitialized parameters were not reversed; their increment size or starting value is unknown.'); continue; }
      else {
        const direction = cc === 96 ? 1 : -1;
        if (number === 0) { const cents = (target.current >> 7) * 100 + (target.current & 127) + direction, bounded = Math.max(0, Math.min(12799, cents)); next = Math.floor(bounded / 100) * 128 + bounded % 100; }
        else next = Math.max(0, Math.min(16383, target.current + direction * ([2, 3, 4].includes(number) ? 128 : 1)));
      }
      set(state, key, initial, target.kind, number, next, event); continue;
    }
    const number = cc >= 32 && cc < 64 ? cc - 32 : cc, kind = number < 32 ? 'cc14' : 'cc';
    const initial = DEFAULT_CC.has(number) ? DEFAULT_CC.get(number) * (kind === 'cc14' ? 128 : 1) : undefined;
    const target = lane(state, `cc:${number}`, initial, kind, number);
    const next = kind === 'cc' ? value : cc < 32 ? value * 128 : ((target.current ?? 0) & 16256) + value;
    set(state, target.key, initial, kind, number, next, event);
  }
  return channels;
}

export function midiStateMessages(lane, value) {
  const cc = (a, b) => [11, a, b];
  switch (lane.kind) {
    case 'patch': return [cc(0, value[0]), cc(32, value[1]), [12, value[2], 0]];
    case 'bank': return [cc(0, value[0]), cc(32, value[1])];
    case 'rpn-selector': return [cc(101, value[0]), cc(100, value[1])];
    case 'nrpn-selector': return [cc(99, value[0]), cc(98, value[1])];
    case 'cc14': return [cc(lane.number, value >> 7), cc(lane.number + 32, value & 127)];
    case 'cc': return [cc(lane.number, value)];
    case 'bend': return [[14, value & 127, value >> 7]];
    case 'pressure': return [[13, value, 0]];
    case 'poly': return [[10, lane.number, value]];
    case 'rpn': case 'nrpn': {
      const msb = lane.kind === 'rpn' ? 101 : 99;
      return [cc(msb, lane.number >> 7), cc(msb - 1, lane.number & 127), cc(6, value >> 7), cc(38, value & 127), cc(101, 127), cc(100, 127)];
    }
    default: return [];
  }
}

function encodeTracks(tracks, ppq, endTick) {
  let eventCount = 0, byteCount = 14;
  if (tracks.length > MIDI_MIXER_LIMITS.tracks) throw new Error('The reversed MIDI needs too many tracks; the source is unchanged.');
  const chunks = tracks.map(events => {
    events.sort(ordered); const data = []; let previous = 0, port = 0;
    const write = (tick, bytes) => {
      if (++eventCount > MIDI_MIXER_LIMITS.events) throw new Error('The rewritten MIDI exceeds the event limit; no notes were removed.');
      const delta = tick - previous;
      if (delta > 0x0fffffff) throw new Error('The rewritten MIDI has an unsupported gap between events.');
      for (const value of vlq(delta)) data.push(value);
      for (const value of bytes) data.push(value);
      previous = tick;
      if (data.length + byteCount > MIDI_MIXER_LIMITS.fileBytes) throw new Error('The rewritten MIDI exceeds 10 MB; no notes were removed.');
    };
    for (const event of events) {
      if (event.channel != null) {
        const nextPort = Math.floor(event.channel / 16); if (nextPort !== port) { write(event.tick, [255, 33, 1, nextPort]); port = nextPort; }
        const bytes = [event.kind * 16 + event.channel % 16, event.a]; if (event.kind !== 12 && event.kind !== 13) bytes.push(event.b);
        write(event.tick, bytes);
      } else write(event.tick, event.bytes);
    }
    write(endTick, [255, 47, 0]);
    const output = new Uint8Array(data.length + 8); output.set([77, 84, 114, 107]); new DataView(output.buffer).setUint32(4, data.length); output.set(data, 8); byteCount += output.length;
    return output;
  });
  if (byteCount > MIDI_MIXER_LIMITS.fileBytes) throw new Error('The rewritten MIDI exceeds 10 MB; no notes were removed.');
  const output = new Uint8Array(byteCount), view = new DataView(output.buffer);
  output.set([77, 84, 104, 100, 0, 0, 0, 6, 0, 1]); view.setUint16(10, tracks.length); view.setUint16(12, ppq);
  let cursor = 14; for (const chunk of chunks) { output.set(chunk, cursor); cursor += chunk.length; }
  return output.buffer;
}

function keyData(key) {
  const minor = key.label.endsWith(' minor'), names = minor ? ['A♭', 'E♭', 'B♭', 'F', 'C', 'G', 'D', 'A', 'E', 'B', 'F♯', 'C♯', 'G♯', 'D♯', 'A♯'] : ['C♭', 'G♭', 'D♭', 'A♭', 'E♭', 'B♭', 'F', 'C', 'G', 'D', 'A', 'E', 'B', 'F♯', 'C♯'];
  const fifths = names.indexOf(key.label.replace(/ (major|minor)$/, '')) - 7;
  return fifths >= -7 ? [(fifths + 256) % 256, Number(minor)] : null;
}

/** A fresh, downloadable SMF plus the exact analysis used for playback.
 * `notes` reverses key gates with the setup heard at each channel's first note.
 * `controllers` also reverses known parameter states and bakes pedal holds.
 * Source objects/bytes are immutable; any unavoidable MIDI-1 limits are explicit.
 */
export function reverseMidiAnalysis(input, { mode = 'notes' } = {}) {
  if (mode !== 'notes' && mode !== 'controllers') throw new Error('Choose Notes or Notes + controllers for MIDI reverse.');
  const bytes = bytesOf(input?.buffer && !ArrayBuffer.isView(input) && !input?.events ? input.buffer : input);
  const source = input?.notes && input?.events ? input : parseMidi(bytes);
  if (!source.notes?.length || source.notes.length > MIDI_MIXER_LIMITS.notes || source.events.length > MIDI_MIXER_LIMITS.events) throw new Error('This MIDI cannot be reversed within the mixer limits.');
  const warnings = new Set(), warn = message => warnings.add(message), ppq = source.ppq, endTick = Math.round(source.durationBeats * ppq);
  const notes = noteIntervals(source, mode, warn), histories = buildMidiStateHistories(source, { onWarning: warn }), { metadata, sysex } = sourceMetadata(bytes, source);
  const tracks = Array.from({ length: source.trackCount + 1 }, () => []), conductor = tracks[0]; let serial = 0;
  conductor.push({ tick: 0, order: -Infinity, bytes: metaBytes(3, textBytes(`Reverse MIDI · ${mode}`)) });
  const emit = (tick, channel, messages, order) => { for (const [kind, a, b] of messages) conductor.push({ tick, channel, kind, a, b, order: order + (++serial) / 1000000000 }); };
  for (const [channel, state] of histories) {
    const first = state.first ?? { tick: 0, order: Infinity };
    for (const lane of state.lanes.values()) {
      if (lane.kind.endsWith('-selector') || lane.kind === 'bank' || lane.kind === 'cc' && HOLD_CC.has(lane.number)) continue; // reversed transactions are self-contained; holds are baked
      let value = lane.initial;
      if (mode === 'notes') {
        if (lane.assumedInitial) value = undefined;
        for (const change of lane.changes) if (change.tick < first.tick || change.tick === first.tick && change.order < first.order) value = change.value;
        if (value !== undefined) emit(0, channel, midiStateMessages(lane, value), -10000000);
      } else {
        if (lane.current !== undefined) emit(0, channel, midiStateMessages(lane, lane.current), -10000000);
        for (const change of lane.changes) if (change.tick > 0 && change.previous !== undefined) emit(endTick - change.tick, channel, midiStateMessages(lane, change.previous), -change.order);
      }
    }
    emit(0, channel, [[11, 64, 0], [11, 66, 0]], -1);
    emit(endTick, channel, [[11, 64, 0], [11, 66, 0]], Infinity);
  }
  if (mode === 'notes' && source.events.some(event => event.kind !== 8 && event.kind !== 9 && event.beat > (histories.get(event.channel)?.first?.tick ?? 0) / ppq)) warn('Notes reverse keeps the initial channel setup and ignores later automation.');
  for (const note of notes) {
    tracks[note.track + 1].push({ tick: note.start, order: 1 + note.reverseOrder / (source.noteCount + 1), channel: note.channel, kind: 9, a: note.note, b: note.velocity });
    tracks[note.track + 1].push({ tick: note.end, order: note.reverseOrder / (source.noteCount + 1), channel: note.channel, kind: 8, a: note.note, b: note.releaseVelocity });
  }
  const addMap = (map, type, dataFor) => {
    const valid = map.filter(item => item.beat * ppq < endTick).map(item => ({ ...item, data: dataFor(item) })).filter(item => item.data);
    if (!valid.length) return;
    const add = (tick, item) => conductor.push({ tick, order: -Infinity, bytes: metaBytes(type, item.data) });
    if (mode === 'notes') for (const item of valid) add(Math.round(item.beat * ppq), item);
    else {
      add(0, valid.at(-1));
      for (let i = valid.length - 1; i > 0; i--) add(endTick - Math.round(valid[i].beat * ppq), valid[i - 1]);
    }
  };
  addMap(source.tempoMap, 0x51, item => { const micros = Math.round(60000000 / item.bpm); return [micros >> 16, micros >> 8 & 255, micros & 255]; });
  addMap(source.meterMap, 0x58, item => [item.numerator, Math.log2(item.denominator), 24, 8]);
  addMap(source.keyMap ?? [], 0x59, keyData);
  for (const item of metadata) {
    // Track/sequence/instrument names stay at the beginning. Lyrics, markers and
    // other annotations retain their bytes at the mirrored timeline position.
    const tick = [0, 2, 3, 4].includes(item.type) ? 0 : Math.max(0, endTick - item.tick);
    tracks[item.track + 1].push({ tick, order: -1000 + item.order / 10000000, bytes: metaBytes(item.type, item.data) });
  }
  for (const track of source.tracks) if (!metadata.some(item => item.track === track.index && item.type === 3)) tracks[track.index + 1].push({ tick: 0, order: -Infinity, bytes: metaBytes(3, textBytes(track.name)) });
  if (sysex || source.warnings?.some(warning => warning.includes('system-exclusive'))) warn('Device-specific SysEx is omitted from reversed playback and download; its internal state cannot be reversed safely.');
  const buffer = encodeTracks(tracks, ppq, endTick), analysis = parseMidi(buffer);
  if (analysis.noteCount !== source.noteCount) throw new Error('Could not preserve every note in the reversed MIDI.');
  analysis.warnings = [...analysis.warnings, ...warnings];
  return { buffer, analysis, mode, durationBeats: source.durationBeats, warnings: [...warnings] };
}

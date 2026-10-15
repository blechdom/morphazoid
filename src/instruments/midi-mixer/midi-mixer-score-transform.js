import { parseMidi, clamp, MIDI_SAMPLE_LIMITS } from './midi-mixer-model.js';

const bytesOf = input => input instanceof ArrayBuffer ? new Uint8Array(input)
  : ArrayBuffer.isView(input) ? new Uint8Array(input.buffer, input.byteOffset, input.byteLength) : null;
const vlq = value => {
  const bytes = [value & 127];
  while ((value = Math.floor(value / 128))) bytes.unshift((value & 127) | 128);
  return bytes;
};
function trackChunk(events) {
  events.sort((a, b) => a.tick - b.tick || a.order - b.order);
  const data = []; let previous = 0;
  for (const event of events) { for (const byte of vlq(event.tick - previous)) data.push(byte); for (const byte of event.bytes) data.push(byte); previous = event.tick; }
  const chunk = new Uint8Array(data.length + 8);
  chunk.set([77, 84, 114, 107]); new DataView(chunk.buffer).setUint32(4, data.length); chunk.set(data, 8);
  return chunk;
}

/** Bounds for a pitch resize; a one-pitch line remains one pitch wide. */
export function midiStampPitchBounds(notes, pitchWidth = null) {
  let sourceLow = 127, sourceHigh = 0;
  for (const note of notes) { sourceLow = Math.min(sourceLow, note.note); sourceHigh = Math.max(sourceHigh, note.note); }
  if (!notes.length) sourceLow = sourceHigh = 0;
  const sourceWidth = sourceHigh - sourceLow + 1;
  const width = sourceWidth === 1 ? 1 : pitchWidth == null ? sourceWidth : Math.round(clamp(pitchWidth, 1, 128, sourceWidth));
  const low = Math.min(sourceLow, 128 - width);
  return { sourceLow, sourceWidth, width, low, high: low + width - 1 };
}

/** Move pitch/channel routing or shorten key gates, keeping every attack, controller, SysEx and
 * metadata message. Width remaps the complete pitch span; time scales every event
 * and the end-of-track boundary. Pedal-held sound still follows the source pedal messages.
 * Compression is FIFO-safe for repeated pitches: each paired on and off moves
 * by the same convex interpolation, so releases cannot cross one another.
 */
export function transformMidiStamp(input, { gateScale = 1, channel = null, transpose = 0, pitchWidth = null, timeScale = 1 } = {}) {
  const source = bytesOf(input?.buffer && !ArrayBuffer.isView(input) ? input.buffer : input);
  if (!source) throw new Error('Choose a MIDI stamp first.');
  const analysis = parseMidi(source), gate = clamp(gateScale, .01, 1, 1);
  const resizeTime = Number.isFinite(Number(timeScale)) && Number(timeScale) !== 1;
  // Quarter-beat size controls need representable loop edges even in low-PPQ files.
  const outputPpq = resizeTime ? Math.min(32764, Math.max(960, Math.ceil(analysis.ppq / 4) * 4)) : analysis.ppq;
  const stretch = resizeTime ? clamp(timeScale, 1 / (outputPpq * analysis.durationBeats), MIDI_SAMPLE_LIMITS.beats / analysis.durationBeats, 1) : 1;
  const pitch = midiStampPitchBounds(analysis.notes, pitchWidth);
  const mapPitch = value => (pitch.width === pitch.sourceWidth ? value : Math.round(clamp(pitch.low + (value - pitch.sourceLow) * (pitch.width - 1) / Math.max(1, pitch.sourceWidth - 1), 0, 127))) + appliedTranspose;
  const scaleTick = value => Math.round(value * stretch * outputPpq / analysis.ppq);
  const targetChannel = channel == null ? null : Math.round(clamp(channel, 0, 15, 0));
  const requestedTranspose = Math.round(clamp(transpose, -127, 127, 0));
  const appliedTranspose = analysis.notes.length ? clamp(requestedTranspose, -pitch.low, 127 - pitch.high, 0) : 0;
  const buffer = source.buffer.slice(source.byteOffset, source.byteOffset + source.byteLength);
  if (gate === 1 && targetChannel === null && !appliedTranspose && pitch.width === pitch.sourceWidth && stretch === 1) return { buffer, analysis, gateScale: gate, appliedTranspose, channel: targetChannel, pitchWidth: pitch.width, timeScale: stretch, adjustedNoteCount: 0, warnings: [] };

  const notes = new Map(analysis.notes.map(note => [note.id, note]));
  const releases = new Map(), paired = new Set();
  for (const event of analysis.events) if (event.kind === 8 && notes.has(event.noteId)) {
    const note = notes.get(event.noteId), onTick = Math.round(note.beat * analysis.ppq), oldTick = Math.round(event.beat * analysis.ppq);
    // Zero-time releases reconstruct notes already held by a sustain pedal.
    releases.set(event.order, oldTick === onTick ? oldTick : Math.max(onTick + 1, Math.round(onTick + (oldTick - onTick) * gate)));
    paired.add(note.id);
  }
  const view = new DataView(buffer), headerEnd = 8 + view.getUint32(4), header = source.slice(0, headerEnd), chunks = [];
  let cursor = headerEnd, sequence = 0, adjustedNoteCount = 0;
  // parseMidi above validates the structure and bounds before this byte-preserving pass.
  for (let track = 0; track < analysis.trackCount; track++) {
    const end = cursor + 8 + view.getUint32(cursor + 4); cursor += 8;
    const events = []; let tick = 0, running = 0;
    const readVlq = () => { let value = 0, byte; do { byte = source[cursor++]; value = value * 128 + (byte & 127); } while (byte & 128); return value; };
    while (cursor < end) {
      tick += readVlq(); sequence++;
      let status = source[cursor];
      if (status < 128) status = running; else cursor++;
      let bytes;
      if (status === 255) {
        running = 0; const type = source[cursor++], size = readVlq();
        bytes = [status, type, ...vlq(size), ...source.subarray(cursor, cursor + size)]; cursor += size;
        // A selected channel is a GM channel in port zero, including files
        // whose original tracks use explicit MIDI port metadata.
        if (type === 33 && size === 1 && targetChannel !== null) bytes[3] = 0;
        if (type === 32 && size === 1 && targetChannel !== null) bytes[3] = targetChannel;
        events.push({ tick: scaleTick(tick), order: sequence, bytes });
        if (type === 47) { cursor = end; break; }
        continue;
      }
      if (status === 240 || status === 247) {
        running = 0; const size = readVlq(); bytes = [status, ...vlq(size), ...source.subarray(cursor, cursor + size)]; cursor += size;
      } else {
        running = status; const size = (status >> 4) === 12 || (status >> 4) === 13 ? 1 : 2;
        bytes = [targetChannel === null ? status : (status & 240) | targetChannel, ...source.subarray(cursor, cursor + size)]; cursor += size;
        if ([8, 9, 10].includes(status >> 4)) bytes[1] = clamp(mapPitch(bytes[1]), 0, 127, bytes[1]);
      }
      const movedTick = releases.get(sequence) ?? tick;
      if (movedTick !== tick) adjustedNoteCount++;
      events.push({ tick: scaleTick(movedTick), order: sequence, bytes });
    }
    chunks.push(trackChunk(events));
  }
  // A malformed-but-playable source may omit note-offs. Add complete releases
  // in explicit-port tracks without rewriting the source track's port changes.
  const missing = new Map();
  for (const note of analysis.notes) if (gate !== 1 && !paired.has(note.id)) {
    const port = targetChannel === null ? Math.floor(note.channel / 16) : 0;
    if (!missing.has(port)) missing.set(port, [{ tick: 0, order: -1, bytes: [255, 33, 1, port] }]);
    missing.get(port).push({ tick: scaleTick(Math.max(Math.round(note.beat * analysis.ppq) + 1, Math.round((note.beat + note.duration * gate) * analysis.ppq))), order: note.id,
      bytes: [128 + (targetChannel ?? note.channel % 16), mapPitch(note.note), 0] }); adjustedNoteCount++;
  }
  for (const events of missing.values()) {
    events.push({ tick: scaleTick(Math.round(analysis.durationBeats * analysis.ppq)), order: Infinity, bytes: [255, 47, 0] }); chunks.push(trackChunk(events));
  }
  if (chunks.length > 65535) throw new Error('This stamp has too many MIDI tracks.');
  const headerView = new DataView(header.buffer, header.byteOffset, header.byteLength);
  headerView.setUint16(12, outputPpq); headerView.setUint16(10, chunks.length); if (chunks.length > 1) headerView.setUint16(8, 1);
  const output = new Uint8Array(header.length + chunks.reduce((sum, chunk) => sum + chunk.length, 0));
  output.set(header); let offset = header.length;
  for (const chunk of chunks) { output.set(chunk, offset); offset += chunk.length; }
  if (output.byteLength > MIDI_SAMPLE_LIMITS.fileBytes) throw new Error('The edited stamp exceeds the MIDI sample size limit; no notes were removed.');
  const transformed = parseMidi(output);
  if (transformed.noteCount !== analysis.noteCount) throw new Error('Could not preserve every note in the edited stamp.');
  if (transformed.events.length > MIDI_SAMPLE_LIMITS.events) throw new Error('The edited stamp exceeds the MIDI sample event limit; no notes were removed.');
  return { buffer: output.buffer, analysis: transformed, gateScale: gate, appliedTranspose, channel: targetChannel, pitchWidth: pitch.width, timeScale: stretch, adjustedNoteCount,
    warnings: missing.size ? ['Missing note-offs were completed at the chosen gate length.'] : [] };
}

/** Rotate note attacks counterclockwise in pitch-right / time-up space.
 *
 * The source attack bounds become a centered unit rectangle (a constant axis
 * stays at its center). Rotate, then fit the entire rotated bounding box into
 * the requested pitch/time rectangle; never clip individual notes at an edge.
 * Pitch rounds to semitones, time to ticks at at least 960 PPQ. Reserve the
 * shorter of the smallest source gate and 1/16 of the phrase for the final
 * attack, with a one-tick minimum. Gates scale with height and shorten at the
 * phrase edge; repeated destination pitches use FIFO-safe releases.
 *
 * This is a geometric note transform, not controller-aware reverse playback:
 * all non-note messages keep their payload and chronological progression,
 * scaled to the new phrase height. MIDI ports are restored around moved notes
 * so port changes cannot reroute them. Track ends move to the phrase boundary.
 * Zero/full turns use the existing byte-preserving resize path.
 */
export function rotateMidiStamp(input, { rotationDegrees = 0, pitchWidth = null, heightBeats = null } = {}) {
  const source = bytesOf(input?.buffer && !ArrayBuffer.isView(input) ? input.buffer : input);
  if (!source) throw new Error('Choose a MIDI stamp first.');
  const analysis = parseMidi(source);
  const degrees = Number(rotationDegrees);
  const angle = Number.isFinite(degrees) ? ((degrees % 360) + 360) % 360 : 0;
  const outputPpq = Math.min(32764, Math.max(960, Math.ceil(analysis.ppq / 4) * 4));
  const requestedHeight = heightBeats == null ? analysis.durationBeats : clamp(heightBeats, 1 / outputPpq, MIDI_SAMPLE_LIMITS.beats, analysis.durationBeats);
  if (!angle) {
    const result = transformMidiStamp(source, { pitchWidth, timeScale: requestedHeight / analysis.durationBeats });
    const bounds = midiStampPitchBounds(result.analysis.notes);
    return { ...result, rotationDegrees: 0, heightBeats: result.analysis.durationBeats, pitchLow: bounds.low, pitchHigh: bounds.high };
  }
  if (requestedHeight > MIDI_SAMPLE_LIMITS.beats) throw new Error('The rotated stamp exceeds the MIDI sample phrase limit; no notes were removed.');
  const endTick = Math.max(1, Math.round(requestedHeight * outputPpq));
  const height = endTick / outputPpq, stretch = height / analysis.durationBeats;
  const sourcePitch = midiStampPitchBounds(analysis.notes);
  let firstBeat = Infinity, lastBeat = -Infinity, smallestGate = Infinity;
  for (const note of analysis.notes) {
    firstBeat = Math.min(firstBeat, note.beat); lastBeat = Math.max(lastBeat, note.beat);
    smallestGate = Math.min(smallestGate, note.duration);
  }
  const gateReserve = Math.max(1, Math.min(Math.round(smallestGate * stretch * outputPpq), Math.round(endTick / 16)));
  const attackTicks = endTick - gateReserve;
  const quadrant = angle / 90;
  const cos = Number.isInteger(quadrant) ? [1, 0, -1, 0][quadrant] : Math.cos(angle * Math.PI / 180);
  const sin = Number.isInteger(quadrant) ? [0, 1, 0, -1][quadrant] : Math.sin(angle * Math.PI / 180);
  // A vertical line can acquire width when rotated, unlike a simple resize.
  // With no requested width, use the keyboard when time is its only extent.
  const naturalWidth = sourcePitch.sourceWidth === 1 && lastBeat !== firstBeat && sin !== 0 ? 128 : sourcePitch.sourceWidth;
  const width = pitchWidth == null ? naturalWidth : Math.round(clamp(pitchWidth, 1, 128, naturalWidth));
  const low = Math.min(sourcePitch.sourceLow, 128 - width);
  const points = []; let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const note of analysis.notes) {
    const x = sourcePitch.sourceWidth === 1 ? 0 : (note.note - sourcePitch.sourceLow) / (sourcePitch.sourceWidth - 1) - .5;
    const y = lastBeat === firstBeat ? 0 : (note.beat - firstBeat) / (lastBeat - firstBeat) - .5;
    const rx = x * cos - y * sin, ry = x * sin + y * cos;
    points.push({ note, x: rx, y: ry });
    minX = Math.min(minX, rx); maxX = Math.max(maxX, rx); minY = Math.min(minY, ry); maxY = Math.max(maxY, ry);
  }
  // Floating-point cancellation must not stretch a diagonal's near-zero axis.
  const normalized = (value, min, max) => max - min < 1e-12 ? .5 : (value - min) / (max - min);
  const rotated = points.map(({ note, x, y }) => {
    const tick = Math.round(normalized(y, minY, maxY) * attackTicks);
    return { note, tick, pitch: low + Math.round(normalized(x, minX, maxX) * (width - 1)),
      offTick: Math.min(endTick, tick + Math.max(1, Math.round(note.duration * stretch * outputPpq))) };
  });
  // Once distinct source pitches land on the same key, preserve FIFO pairing
  // even if their original gates would otherwise cross after the rotation.
  const voices = new Map();
  for (const note of rotated) {
    const key = note.note.channel * 128 + note.pitch;
    if (!voices.has(key)) voices.set(key, []);
    voices.get(key).push(note);
  }
  for (const voice of voices.values()) {
    voice.sort((a, b) => a.tick - b.tick || a.note.id - b.note.id);
    let previousOff = 0;
    for (const note of voice) previousOff = note.offTick = Math.max(previousOff, note.offTick);
  }
  const releases = new Map();
  for (const event of analysis.events) if (event.kind === 8 && event.noteId != null) releases.set(event.noteId, event);
  const view = new DataView(source.buffer, source.byteOffset, source.byteLength);
  const headerEnd = 8 + view.getUint32(4), header = source.slice(0, headerEnd), tracks = [];
  const scaleTick = tick => Math.min(endTick, Math.round(tick * stretch * outputPpq / analysis.ppq));
  let cursor = headerEnd, sequence = 0;
  // parseMidi has already validated the raw stream; retain metadata and SysEx
  // that are intentionally absent from its playback event representation.
  for (let track = 0; track < analysis.trackCount; track++) {
    const end = cursor + 8 + view.getUint32(cursor + 4); cursor += 8;
    const events = []; let tick = 0, running = 0, port = 0;
    const readVlq = () => { let value = 0, byte; do { byte = source[cursor++]; value = value * 128 + (byte & 127); } while (byte & 128); return value; };
    while (cursor < end) {
      tick += readVlq(); sequence++;
      let status = source[cursor];
      if (status < 128) status = running; else cursor++;
      let bytes, eventPort;
      if (status === 255) {
        running = 0; const type = source[cursor++], size = readVlq();
        bytes = [status, type, ...vlq(size), ...source.subarray(cursor, cursor + size)]; cursor += size;
        if (type === 47) { cursor = end; break; }
        if (type === 33 && size === 1) port = bytes[3];
      } else if (status === 240 || status === 247) {
        running = 0; const size = readVlq(); bytes = [status, ...vlq(size), ...source.subarray(cursor, cursor + size)]; cursor += size;
        eventPort = port;
      } else {
        running = status; const kind = status >> 4, size = kind === 12 || kind === 13 ? 1 : 2;
        bytes = [status, ...source.subarray(cursor, cursor + size)]; cursor += size;
        if (kind === 8 || kind === 9) continue;
        eventPort = port;
      }
      events.push({ tick: scaleTick(tick), order: sequence, bytes, port: eventPort });
    }
    tracks.push(events);
  }
  let completedReleases = 0;
  for (const { note, tick, pitch, offTick } of rotated) {
    const events = tracks[note.track], port = Math.floor(note.channel / 16), channel = note.channel % 16;
    const release = releases.get(note.id);
    if (!release) completedReleases++;
    events.push({ tick, order: note.id, port, bytes: [144 | channel, pitch, note.velocity] });
    events.push({ tick: offTick, order: note.id + .5, port, bytes: [128 | channel, pitch, release?.b ?? 0] });
  }
  const chunks = tracks.map(events => {
    events.sort((a, b) => a.tick - b.tick || a.order - b.order);
    const routed = []; let port = 0;
    for (const event of events) {
      if (event.port != null && event.port !== port) {
        port = event.port;
        routed.push({ tick: event.tick, order: event.order, bytes: [255, 33, 1, port] });
      }
      if (event.bytes[0] === 255 && event.bytes[1] === 33 && event.bytes[2] === 1) port = event.bytes[3];
      routed.push(event);
    }
    routed.push({ tick: endTick, order: Infinity, bytes: [255, 47, 0] });
    return trackChunk(routed);
  });
  new DataView(header.buffer, header.byteOffset, header.byteLength).setUint16(12, outputPpq);
  const output = new Uint8Array(header.length + chunks.reduce((sum, chunk) => sum + chunk.length, 0));
  output.set(header); let offset = header.length;
  for (const chunk of chunks) { output.set(chunk, offset); offset += chunk.length; }
  if (output.byteLength > MIDI_SAMPLE_LIMITS.fileBytes) throw new Error('The rotated stamp exceeds the MIDI sample size limit; no notes were removed.');
  const transformed = parseMidi(output);
  if (transformed.noteCount !== analysis.noteCount) throw new Error('Could not preserve every note in the rotated stamp.');
  if (transformed.events.length > MIDI_SAMPLE_LIMITS.events) throw new Error('The rotated stamp exceeds the MIDI sample event limit; no notes were removed.');
  return { buffer: output.buffer, analysis: transformed, rotationDegrees: angle, pitchWidth: width, heightBeats: height,
    pitchLow: low, pitchHigh: low + width - 1, timeScale: stretch, adjustedNoteCount: analysis.noteCount,
    warnings: completedReleases ? ['Missing note-offs were completed inside the rotated phrase.'] : [] };
}

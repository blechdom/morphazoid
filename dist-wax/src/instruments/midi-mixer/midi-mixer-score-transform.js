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

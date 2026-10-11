/** Standard MIDI inspection without Web Audio, DOM, or a third-party parser. */
export const MIDI_MIXER_LIMITS = Object.freeze({ fileBytes: 10 * 1024 * 1024, tracks: 1024, events: 1200000, notes: 600000, channels: 64, beats: 1000000 });
export const GM_PROGRAM_NAMES = Object.freeze(('Acoustic Grand Piano|Bright Acoustic Piano|Electric Grand Piano|Honky-tonk Piano|Electric Piano 1|Electric Piano 2|Harpsichord|Clavinet|Celesta|Glockenspiel|Music Box|Vibraphone|Marimba|Xylophone|Tubular Bells|Dulcimer|Drawbar Organ|Percussive Organ|Rock Organ|Church Organ|Reed Organ|Accordion|Harmonica|Tango Accordion|Acoustic Guitar (nylon)|Acoustic Guitar (steel)|Electric Guitar (jazz)|Electric Guitar (clean)|Electric Guitar (muted)|Overdriven Guitar|Distortion Guitar|Guitar Harmonics|Acoustic Bass|Electric Bass (finger)|Electric Bass (pick)|Fretless Bass|Slap Bass 1|Slap Bass 2|Synth Bass 1|Synth Bass 2|Violin|Viola|Cello|Contrabass|Tremolo Strings|Pizzicato Strings|Orchestral Harp|Timpani|String Ensemble 1|String Ensemble 2|Synth Strings 1|Synth Strings 2|Choir Aahs|Voice Oohs|Synth Voice|Orchestra Hit|Trumpet|Trombone|Tuba|Muted Trumpet|French Horn|Brass Section|Synth Brass 1|Synth Brass 2|Soprano Sax|Alto Sax|Tenor Sax|Baritone Sax|Oboe|English Horn|Bassoon|Clarinet|Piccolo|Flute|Recorder|Pan Flute|Blown Bottle|Shakuhachi|Whistle|Ocarina|Lead 1 (square)|Lead 2 (sawtooth)|Lead 3 (calliope)|Lead 4 (chiff)|Lead 5 (charang)|Lead 6 (voice)|Lead 7 (fifths)|Lead 8 (bass + lead)|Pad 1 (new age)|Pad 2 (warm)|Pad 3 (polysynth)|Pad 4 (choir)|Pad 5 (bowed)|Pad 6 (metallic)|Pad 7 (halo)|Pad 8 (sweep)|FX 1 (rain)|FX 2 (soundtrack)|FX 3 (crystal)|FX 4 (atmosphere)|FX 5 (brightness)|FX 6 (goblins)|FX 7 (echoes)|FX 8 (sci-fi)|Sitar|Banjo|Shamisen|Koto|Kalimba|Bagpipe|Fiddle|Shanai|Tinkle Bell|Agogo|Steel Drums|Woodblock|Taiko Drum|Melodic Tom|Synth Drum|Reverse Cymbal|Guitar Fret Noise|Breath Noise|Seashore|Bird Tweet|Telephone Ring|Helicopter|Applause|Gunshot').split('|'));
export const clamp = (value, low, high, fallback = low) => Math.max(low, Math.min(high, Number.isFinite(Number(value)) ? Number(value) : fallback));
export const modulo = (value, length) => ((value % length) + length) % length;
const decoder = new TextDecoder('utf-8', { fatal: false });
const text = bytes => decoder.decode(bytes).replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, 160);
const ordered = values => values.sort((a, b) => a.beat - b.beat || a.order - b.order);
function uniqueMap(values, initial) {
  const map = [initial];
  for (const event of ordered(values)) {
    const last = map.at(-1);
    if (last.beat === event.beat) map[map.length - 1] = event;
    else map.push(event);
  }
  return map;
}
export function beatsToSeconds(beat, tempoMap) {
  let seconds = 0, previous = 0, bpm = 120;
  for (const tempo of tempoMap) {
    if (tempo.beat >= beat) break;
    seconds += (tempo.beat - previous) * 60 / bpm;
    previous = tempo.beat; bpm = tempo.bpm;
  }
  return seconds + Math.max(0, beat - previous) * 60 / bpm;
}
function estimateKey(notes) {
  // Duration-weighted diatonic template; this is a rough tonal estimate, not a key detector.
  const weights = new Float64Array(12);
  for (const note of notes) if (note.channel % 16 !== 9) weights[note.note % 12] += Math.min(16, note.duration) * note.velocity / 127;
  if (!weights.some(value => value > 0)) return { label: 'Unknown', source: 'unknown' };
  const major = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88];
  const minor = [6.33, 2.68, 3.52, 5.38, 2.60, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17];
  let best = -Infinity, tonic = 0, mode = 'major';
  for (const [name, profile] of [['major', major], ['minor', minor]]) {
    const mean = profile.reduce((a, b) => a + b, 0) / 12;
    const norm = Math.sqrt(profile.reduce((a, b) => a + (b - mean) ** 2, 0));
    for (let root = 0; root < 12; root++) {
      const score = weights.reduce((sum, value, pitch) => sum + value * (profile[modulo(pitch - root, 12)] - mean), 0) / norm;
      if (score > best) { best = score; tonic = root; mode = name; }
    }
  }
  return { label: `${['C', 'C♯', 'D', 'E♭', 'E', 'F', 'F♯', 'G', 'A♭', 'A', 'B♭', 'B'][tonic]} ${mode}`, source: 'estimated' };
}
export function parseMidi(input) {
  const bytes = input instanceof ArrayBuffer ? new Uint8Array(input) : ArrayBuffer.isView(input) ? new Uint8Array(input.buffer, input.byteOffset, input.byteLength) : null;
  if (!bytes || bytes.length < 14) throw new Error('Choose a Standard MIDI file (.mid or .midi).');
  if (bytes.length > MIDI_MIXER_LIMITS.fileBytes) throw new Error('MIDI files must be 10 MB or smaller.');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (view.getUint32(0) !== 0x4d546864) throw new Error('This is not a Standard MIDI file.');
  const headerLength = view.getUint32(4), format = view.getUint16(8), trackCount = view.getUint16(10), ppq = view.getUint16(12);
  if (headerLength < 6 || 8 + headerLength > bytes.length || !trackCount || trackCount > MIDI_MIXER_LIMITS.tracks) throw new Error('Invalid MIDI header or too many tracks.');
  if (format > 1) throw new Error('MIDI format 2 has independent timelines. Export as format 0 or 1 to mix it.');
  if (!ppq || ppq & 0x8000) throw new Error('SMPTE-time MIDI is not supported. Export with ticks per quarter note.');
  if (format === 0 && trackCount !== 1) throw new Error('MIDI format 0 must contain one track.');
  const events = [], tempos = [], meters = [], keys = [], tracks = [], warnings = [];
  let cursor = 8 + headerLength, sequence = 0, durationBeats = 0, ignoredSysEx = 0;
  const requireBytes = (position, count, end) => { if (position + count > end) throw new Error('The MIDI file is truncated.'); };
  for (let track = 0; track < trackCount; track++) {
    requireBytes(cursor, 8, bytes.length);
    if (view.getUint32(cursor) !== 0x4d54726b) throw new Error('Missing MIDI track chunk.');
    const length = view.getUint32(cursor + 4), end = cursor + 8 + length;
    requireBytes(cursor + 8, length, bytes.length); cursor += 8;
    let tick = 0, running = 0, port = 0, name = '', eventCount = 0;
    const trackChannels = new Set();
    const vlq = () => {
      let value = 0;
      for (let i = 0; i < 4; i++) {
        requireBytes(cursor, 1, end); const byte = bytes[cursor++]; value = value * 128 + (byte & 127);
        if (!(byte & 128)) return value;
      }
      throw new Error('Invalid MIDI variable-length number.');
    };
    while (cursor < end) {
      tick += vlq(); const beat = tick / ppq;
      if (beat > MIDI_MIXER_LIMITS.beats) throw new Error('This MIDI timeline exceeds the mixer limit.');
      durationBeats = Math.max(durationBeats, beat);
      requireBytes(cursor, 1, end); let status = bytes[cursor];
      if (status < 128) { if (!running) throw new Error('Invalid MIDI running status.'); status = running; }
      else cursor++;
      if (++sequence > MIDI_MIXER_LIMITS.events) throw new Error('This MIDI exceeds 1.2 million events.');
      eventCount++;
      if (status === 255) {
        running = 0; requireBytes(cursor, 1, end); const type = bytes[cursor++], size = vlq();
        requireBytes(cursor, size, end); const data = bytes.subarray(cursor, cursor + size); cursor += size;
        if (type === 3) name = text(data);
        if (type === 0x21 && size === 1) port = data[0];
        if (type === 0x51 && size === 3) {
          const micros = data[0] * 65536 + data[1] * 256 + data[2];
          if (micros) tempos.push({ beat, bpm: 60000000 / micros, order: sequence });
        }
        if (type === 0x58 && size >= 2 && data[0] && data[1] <= 7) meters.push({ beat, numerator: data[0], denominator: 2 ** data[1], order: sequence });
        if (type === 0x59 && size >= 2) {
          const fifths = data[0] > 127 ? data[0] - 256 : data[0];
          if (fifths >= -7 && fifths <= 7 && data[1] <= 1) {
            const labels = data[1] ? ['A♭', 'E♭', 'B♭', 'F', 'C', 'G', 'D', 'A', 'E', 'B', 'F♯', 'C♯', 'G♯', 'D♯', 'A♯'] : ['C♭', 'G♭', 'D♭', 'A♭', 'E♭', 'B♭', 'F', 'C', 'G', 'D', 'A', 'E', 'B', 'F♯', 'C♯'];
            keys.push({ beat, label: `${labels[fifths + 7]} ${data[1] ? 'minor' : 'major'}`, source: 'embedded', order: sequence });
          }
        }
        if (type === 0x2f) { cursor = end; break; }
      } else if (status === 0xf0 || status === 0xf7) {
        running = 0; const size = vlq(); requireBytes(cursor, size, end); cursor += size; ignoredSysEx++;
      } else if (status >= 0x80 && status < 0xf0) {
        running = status; const kind = status >> 4, size = kind === 12 || kind === 13 ? 1 : 2;
        requireBytes(cursor, size, end); const a = bytes[cursor++], b = size === 2 ? bytes[cursor++] : 0;
        if (a > 127 || b > 127) throw new Error('Invalid MIDI channel data.');
        const channel = port * 16 + (status & 15); trackChannels.add(channel);
        events.push({ beat, channel, kind: kind === 9 && b === 0 ? 8 : kind, a, b, track, order: sequence });
      } else throw new Error('Unsupported system event in MIDI track.');
    }
    tracks.push({ index: track, name: name || `Track ${track + 1}`, eventCount, channels: [...trackChannels] });
  }
  ordered(events);
  const channels = new Map(), active = new Map(), notes = [];
  const finish = (note, end) => { note.duration = Math.max(1 / ppq, end - note.beat); notes.push(note); if (notes.length > MIDI_MIXER_LIMITS.notes) throw new Error('This MIDI exceeds 600,000 notes.'); };
  for (const event of events) {
    let channel = channels.get(event.channel);
    if (!channel) {
      if (channels.size >= MIDI_MIXER_LIMITS.channels) throw new Error('The mixer supports up to 64 MIDI channels per file.');
      channel = { channel: event.channel, port: Math.floor(event.channel / 16), program: 0, programs: new Set(), drums: event.channel % 16 === 9, noteCount: 0, minNote: 127, maxNote: 0, tracks: new Set() };
      channels.set(event.channel, channel);
    }
    channel.tracks.add(event.track);
    if (event.kind === 12) { channel.programs.add(event.a); if (!channel.noteCount) channel.program = event.a; }
    if (event.kind === 9) {
      channel.noteCount++; channel.minNote = Math.min(channel.minNote, event.a); channel.maxNote = Math.max(channel.maxNote, event.a);
      const key = event.channel * 128 + event.a; let queue = active.get(key);
      if (!queue) { queue = { values: [], index: 0 }; active.set(key, queue); }
      queue.values.push({ beat: event.beat, duration: 0, channel: event.channel, note: event.a, velocity: event.b, track: event.track });
    } else if (event.kind === 8) {
      const key = event.channel * 128 + event.a, queue = active.get(key);
      if (queue && queue.index < queue.values.length) { finish(queue.values[queue.index++], event.beat); if (queue.index === queue.values.length) active.delete(key); }
    }
  }
  for (const queue of active.values()) for (let i = queue.index; i < queue.values.length; i++) finish(queue.values[i], durationBeats);
  if (!notes.length) throw new Error('This MIDI file contains no notes.');
  notes.sort((a, b) => a.beat - b.beat);
  durationBeats = Math.max(durationBeats, notes.at(-1).beat + notes.at(-1).duration, 1 / ppq);
  const tempoMap = uniqueMap(tempos, { beat: 0, bpm: 120 });
  const meterMap = uniqueMap(meters, { beat: 0, numerator: 4, denominator: 4 });
  const channelList = [...channels.values()].map(channel => ({ ...channel, tracks: [...channel.tracks], programs: [...channel.programs], instrument: channel.drums ? 'Drums' : GM_PROGRAM_NAMES[channel.program], minNote: channel.noteCount ? channel.minNote : null, maxNote: channel.noteCount ? channel.maxNote : null })).sort((a, b) => a.channel - b.channel);
  if (ignoredSysEx) warnings.push(`${ignoredSysEx} system-exclusive messages omitted from remix playback.`);
  return { format, trackCount, ppq, tracks, channels: channelList, events, notes, tempoMap, meterMap, keyMap: ordered(keys), key: ordered(keys)[0] ?? estimateKey(notes), initialTempo: tempoMap[0].bpm, durationBeats, durationSeconds: beatsToSeconds(durationBeats, tempoMap), noteCount: notes.length, firstNoteBeat: notes[0].beat, warnings };
}
export const defaultDeckConfig = () => ({ gain: 1, transpose: 0, offsetBeats: 0, loop: true, mute: false, loopStartBeats: null, loopEndBeats: null });
export function sanitizeDeckConfig(input = {}, previous = defaultDeckConfig()) {
  return { gain: clamp(input.gain ?? previous.gain, 0, 2, previous.gain), transpose: Math.round(clamp(input.transpose ?? previous.transpose, -24, 24, previous.transpose)), offsetBeats: clamp(input.offsetBeats ?? previous.offsetBeats, -1000000, 1000000, previous.offsetBeats), loop: input.loop === undefined ? previous.loop : Boolean(input.loop), mute: input.mute === undefined ? previous.mute : Boolean(input.mute),
    loopStartBeats: input.loopStartBeats === undefined ? previous.loopStartBeats : input.loopStartBeats === null ? null : clamp(input.loopStartBeats, 0, MIDI_MIXER_LIMITS.beats),
    loopEndBeats: input.loopEndBeats === undefined ? previous.loopEndBeats : input.loopEndBeats === null ? null : clamp(input.loopEndBeats, 0, MIDI_MIXER_LIMITS.beats) };
}
export function loopLength(analysis) {
  if (!analysis) return 4;
  const meter = analysis.meterMap[0], bar = meter.numerator * 4 / meter.denominator;
  return Math.max(bar, Math.ceil((analysis.durationBeats - 1e-9) / bar) * bar);
}
export function loopBounds(analysis, config = defaultDeckConfig()) {
  const end = loopLength(analysis), start = clamp(config.loopStartBeats ?? 0, 0, Math.max(0, end - 1 / 32));
  const finish = clamp(config.loopEndBeats ?? end, start + 1 / 32, end);
  return { start, end: finish, length: finish - start };
}
export function deckPosition(beat, analysis, config) {
  const bounds = loopBounds(analysis, config), position = beat + config.offsetBeats;
  return config.loop ? bounds.start + modulo(position, bounds.length) : Math.max(bounds.start, Math.min(bounds.end, bounds.start + position));
}

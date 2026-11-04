// A separate, bounded rail bus: the four editable MIDI sample slots are never
// used for top-rail notes, one-shot left-rail blocks or the looping corner.
export const BLECH_RAIL_SOURCE = 7;
export const BLECH_RAIL_MAX_SOURCES = 192;
export const BLECH_RAIL_MAX_NOTES = 4096;
export const BLECH_RAIL_MAX_VOICES = 384;
export const BLECH_RAIL_MAX_EVENTS_PER_BLOCK = 1024;

const clamp = (value, low, high, fallback = low) =>
  Math.max(low, Math.min(high, Number.isFinite(Number(value)) ? Number(value) : fallback));

export function normalizeBlechRailSource(input, startBeat = 0) {
  if (!['rail', 'comb', 'crossing'].includes(input?.source) || !input?.notes?.length
    || input.notes.length > BLECH_RAIL_MAX_NOTES) throw new Error('This rail pattern is too large.');
  if (input.source === 'rail' && input.notes.length !== 1
    || input.source === 'crossing' && input.notes.length > 128) throw new Error('Choose a valid rail pattern.');
  const channel = Math.round(clamp(input.channel, 0, 15, 0));
  const notes = input.notes.map(note => {
    if (!Number.isInteger(note.note) || note.note < 0 || note.note > 127
      || !Number.isFinite(note.beat) || note.beat < 0 || note.beat > 64
      || !Number.isFinite(note.duration) || note.duration <= 0 || note.duration > 8)
      throw new Error('This rail note is outside the playable area.');
    return { note: note.note, beat: note.beat, duration: note.duration,
      velocity: Math.round(clamp(note.velocity, 1, 127, 88)) };
  }).sort((a, b) => a.beat - b.beat || a.note - b.note);
  const periodBeats = clamp(input.periodBeats, .125, 8, .25);
  if (input.source !== 'comb' && notes.some(note => note.beat !== 0))
    throw new Error('A looping rail starts at the rail.');
  const held = input.source === 'rail' && input.held === true;
  const loop = input.source !== 'comb' && !held;
  const durationBeats = loop || held ? Infinity
    : Math.max(...notes.map(note => note.beat + note.duration));
  return {
    id: String(input.id ?? ''), source: input.source, notes, channel,
    program: input.program == null || input.program === 'original' ? null
      : Math.round(clamp(input.program, 0, 127, 0)),
    gain: clamp(input.gain, 0, 1, .5), startBeat: Math.max(0, Number(startBeat) || 0),
    delayBeats: clamp(input.delayBeats, 0, 64, 0), periodBeats,
    durationBeats, held, loop, paused: false, pauseBeat: null,
    stride: input.stride ?? 1, name: String(input.name ?? 'Rail').slice(0, 128),
  };
}

/** Schedule notes from the *audio* sample clock; neither a drawing frame nor
 * a main-thread timer ever decides an onset. Work is bounded even if the
 * producer stalls or tempo is raised dramatically. */
export class BlechRailClock {
  constructor({ emit = () => {} } = {}) {
    this.emit = emit;
    this.beat = 0;
    this.sources = new Map();
    this.active = new Map();
    this.skippedEvents = 0;
  }
  add(source) {
    if (!this.sources.has(source.id) && this.sources.size >= BLECH_RAIL_MAX_SOURCES) return false;
    this.remove(source.id);
    const entry = { ...source, nextBeat: source.startBeat + source.delayBeats, cursor: 0, serial: 0, pauseBeat: null };
    if (entry.loop && entry.nextBeat < this.beat) {
      entry.nextBeat += Math.ceil((this.beat - entry.nextBeat) / entry.periodBeats) * entry.periodBeats;
    } else if (entry.held && entry.nextBeat < this.beat) entry.nextBeat = this.beat;
    else if (!entry.loop && !entry.held) {
      const base = entry.startBeat + entry.delayBeats;
      // Audio can be armed long after a silent one-shot was placed. Never
      // replay its missed attacks in a burst at the first audio quantum.
      while (entry.cursor < entry.notes.length && base + entry.notes[entry.cursor].beat < this.beat - 1e-9)
        entry.cursor++;
    }
    this.sources.set(entry.id, entry);
    return true;
  }
  releaseNotes(id) {
    for (const [key, note] of this.active) {
      if (note.id !== id) continue;
      this.emit({ kind: 8, a: note.pitch, b: 0, channel: note.channel, noteId: key,
        sourceId: id, beat: this.beat }, 0);
      this.active.delete(key);
    }
  }
  remove(id) {
    if (!this.sources.has(id)) return false;
    this.releaseNotes(id);
    this.sources.delete(id);
    return true;
  }
  pause(id, paused) {
    const entry = this.sources.get(id);
    if (!entry || entry.paused === Boolean(paused)) return false;
    if (paused) { entry.paused = true; entry.pauseBeat = this.beat; this.releaseNotes(id); }
    else {
      const elapsed = Math.max(0, this.beat - entry.pauseBeat);
      entry.startBeat += elapsed;
      entry.nextBeat = entry.held ? this.beat : entry.nextBeat + elapsed;
      entry.pauseBeat = null; entry.paused = false;
    }
    return true;
  }
  rejoin() {
    // Changing banks stops native voices. Held notes begin a new gate without
    // rewinding any repeating or one-shot source's musical position.
    this.active.clear();
    for (const entry of this.sources.values()) if (entry.held && !entry.paused) entry.nextBeat = this.beat;
  }
  stopAll() {
    for (const id of this.sources.keys()) this.releaseNotes(id);
    this.sources.clear();
  }
  process(frames, sampleRate, tempo) {
    if (!(frames > 0 && sampleRate > 0 && tempo > 0)) return;
    const start = this.beat, end = start + frames * tempo / (60 * sampleRate);
    this.beat = end;
    if (!this.sources.size && !this.active.size) return;
    const events = [], add = event => {
      if (events.length >= BLECH_RAIL_MAX_EVENTS_PER_BLOCK) { this.skippedEvents++; return false; }
      events.push(event); return true;
    };
    for (const [key, note] of this.active) if (note.offBeat < end - 1e-9)
      add({ beat: Math.max(start, note.offBeat), kind: 8, id: note.id, key, pitch: note.pitch, channel: note.channel });
    for (const entry of this.sources.values()) {
      if (entry.paused) continue;
      const base = entry.startBeat + entry.delayBeats;
      const lane = entry.source === 'rail' ? 0 : entry.source === 'comb' ? 1 : 2;
      const channel = lane * 16 + entry.channel;
      const send = (note, beat) => add({ beat: Math.max(start, beat), kind: 9, id: entry.id,
        key: `${entry.id}:${entry.serial++}`, pitch: note.note, channel, program: entry.program,
        velocity: Math.min(127, Math.max(1, Math.round(note.velocity * Math.sqrt(entry.gain / .35)))),
        duration: entry.held ? Infinity : note.duration });
      if (entry.loop || entry.held) {
        while (entry.nextBeat < end - 1e-9) {
          for (const note of entry.notes) send(note, entry.nextBeat);
          if (entry.held) { entry.nextBeat = Infinity; break; }
          entry.nextBeat += entry.periodBeats;
          if (events.length >= BLECH_RAIL_MAX_EVENTS_PER_BLOCK) {
            // Missed steps are skipped, never replayed in a later quantum.
            entry.nextBeat += Math.max(0, Math.ceil((end - entry.nextBeat) / entry.periodBeats)) * entry.periodBeats;
            break;
          }
        }
      } else {
        while (entry.cursor < entry.notes.length && base + entry.notes[entry.cursor].beat < end - 1e-9) {
          const note = entry.notes[entry.cursor++];
          send(note, base + note.beat);
          if (events.length >= BLECH_RAIL_MAX_EVENTS_PER_BLOCK) {
            while (entry.cursor < entry.notes.length && base + entry.notes[entry.cursor].beat < end)
              { entry.cursor++; this.skippedEvents++; }
            break;
          }
        }
      }
    }
    // A short gate may start *and* finish within one quantum at fast tempos.
    // Send its off in this same block rather than relying on the next block.
    for (const event of [...events]) if (event.kind === 9 && event.beat + event.duration < end - 1e-9)
      add({ ...event, beat: event.beat + event.duration, kind: 8 });
    events.sort((a, b) => a.beat - b.beat || a.kind - b.kind);
    for (const event of events) {
      if (event.kind === 9) {
        if (this.active.size >= BLECH_RAIL_MAX_VOICES) { this.skippedEvents++; continue; }
        this.active.set(event.key, { id: event.id, pitch: event.pitch, channel: event.channel,
          offBeat: event.beat + event.duration });
      } else if (!this.active.delete(event.key)) continue;
      const frame = Math.max(0, Math.min(frames - 1, Math.round((event.beat - start) * 60 / tempo * sampleRate)));
      this.emit({ kind: event.kind, a: event.pitch, b: event.kind === 9 ? event.velocity : 0,
        channel: event.channel, noteId: event.key, sourceId: event.id, program: event.program,
        beat: event.beat, durationBeats: event.duration }, frame);
    }
    const activeOwners = new Set([...this.active.values()].map(note => note.id));
    for (const [id, entry] of this.sources) if (!entry.loop && !entry.held && !entry.paused
      && entry.cursor === entry.notes.length && !activeOwners.has(id)) this.sources.delete(id);
  }
}

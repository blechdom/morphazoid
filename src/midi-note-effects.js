/** Pure MIDI note expansion and a bounded scheduler in audio-clock seconds. */
export const MIDI_NOTE_CHORDS = Object.freeze(Object.fromEntries(Object.entries({
  single: [0], octave: [0, 12], fifth: [0, 7], major: [0, 4, 7], minor: [0, 3, 7],
}).map(([name, intervals]) => [name, Object.freeze(intervals)])));

export const DEFAULT_MIDI_NOTE_EFFECTS = Object.freeze({
  enabled: false, transpose: 0, velocity: 1, chord: 'single', delayBeats: 0,
  gateBeats: 0, echoCount: 0, echoBeats: .5, echoDecay: .5, drums: false, tempo: 120,
});
const numeric = (value, fallback) => Number.isFinite(Number(value)) ? Number(value) : fallback;
const clamp = (value, low, high, fallback) => Math.max(low, Math.min(high, numeric(value, fallback)));
const boolean = (value, fallback) => typeof value === 'boolean' ? value : fallback;

export function sanitizeMidiNoteEffects(config = {}, base = DEFAULT_MIDI_NOTE_EFFECTS) {
  config = config && typeof config === 'object' ? config : {};
  const previous = base === DEFAULT_MIDI_NOTE_EFFECTS ? base : sanitizeMidiNoteEffects(base);
  const value = key => config[key] === undefined ? previous[key] : config[key];
  const gate = numeric(value('gateBeats'), previous.gateBeats);
  return {
    enabled: boolean(value('enabled'), previous.enabled),
    transpose: Math.round(clamp(value('transpose'), -24, 24, previous.transpose)),
    velocity: clamp(value('velocity'), .25, 2, previous.velocity),
    chord: Object.hasOwn(MIDI_NOTE_CHORDS, value('chord')) ? value('chord') : previous.chord,
    delayBeats: clamp(value('delayBeats'), 0, 1, previous.delayBeats),
    gateBeats: gate === 0 ? 0 : clamp(gate, .0625, 4, previous.gateBeats),
    echoCount: Math.round(clamp(value('echoCount'), 0, 4, previous.echoCount)),
    echoBeats: clamp(value('echoBeats'), .0625, 4, previous.echoBeats),
    echoDecay: clamp(value('echoDecay'), .1, .9, previous.echoDecay),
    drums: boolean(value('drums'), previous.drums),
    tempo: clamp(value('tempo'), 1, 4800, previous.tempo),
  };
}

/** An attack snapshot, also used by silent previews. Durations remain source-owned. */
export function midiNoteEffectChildren(config, note, velocity, { drums = false } = {}) {
  if (![note, velocity].every(Number.isFinite) || velocity <= 0) return [];
  const settings = sanitizeMidiNoteEffects(config), enabled = settings.enabled;
  const pitched = enabled && (!drums || settings.drums), seconds = 60 / settings.tempo;
  const root = Math.round(note + (pitched ? settings.transpose : 0));
  const pitches = (pitched ? MIDI_NOTE_CHORDS[settings.chord] : [0]).map(interval => root + interval).filter(pitch => pitch >= 0 && pitch <= 127);
  const result = [];
  for (let echo = 0; echo <= (enabled ? settings.echoCount : 0); echo++) {
    const strength = Math.round(clamp(velocity * (enabled ? settings.velocity * settings.echoDecay ** echo : 1), 1, 127, 1));
    for (const pitch of pitches) result.push({ note: pitch, velocity: strength,
      delaySeconds: enabled ? (settings.delayBeats + echo * settings.echoBeats) * seconds : 0,
      gateSeconds: enabled && settings.gateBeats ? settings.gateBeats * seconds : Infinity });
  }
  return result;
}

// Removable heap entries keep replacements and cancellation physically bounded;
// no stale tombstones accumulate when a natural release shortens a gate.
const earlier = (a, b) => a.time < b.time || a.time === b.time && (a.type !== b.type ? a.type === 'noteOff' : a.serial < b.serial);
class EventQueue {
  constructor() { this.items = []; }
  swap(a, b) { [this.items[a], this.items[b]] = [this.items[b], this.items[a]]; this.items[a].index = a; this.items[b].index = b; }
  up(index) { while (index > 0) { const parent = (index - 1) >> 1; if (!earlier(this.items[index], this.items[parent])) break; this.swap(index, parent); index = parent; } }
  down(index) {
    for (;;) { let child = index * 2 + 1; if (child >= this.items.length) return;
      if (child + 1 < this.items.length && earlier(this.items[child + 1], this.items[child])) child++;
      if (!earlier(this.items[child], this.items[index])) return; this.swap(index, child); index = child; }
  }
  add(event) { event.index = this.items.length; this.items.push(event); this.up(event.index); return event; }
  remove(event) {
    if (!event || event.index < 0) return;
    const index = event.index, last = this.items.pop(); event.index = -1;
    if (last !== event) { this.items[index] = last; last.index = index; this.up(index); this.down(last.index); }
  }
  pop() { const event = this.items[0]; if (event) this.remove(event); return event; }
}

/**
 * Feed source events chronologically. noteOn/noteOff advance through their time;
 * advance() services later echoes/gates without any browser or timer dependency.
 * Every sounded child emits exactly one visual and musical off, preserving
 * native MIDI FIFO semantics even when several children share a channel/pitch.
 */
export class MidiNoteEffects {
  constructor({ emit = () => {}, maxGroups = 512, maxEvents = 4096 } = {}) {
    this.emit = typeof emit === 'function' ? emit : () => {};
    this.maxGroups = Math.round(clamp(maxGroups, 1, 4096, 512));
    this.maxEvents = Math.round(clamp(maxEvents, 2, 65536, 4096));
    this._config = sanitizeMidiNoteEffects(); this._queue = new EventQueue();
    this._groups = new Map(); this._children = new Map(); this._optional = new Map();
    this._keys = new Map(); this._fifo = new Map();
    this._time = 0; this._serial = 0; this._active = 0; this._dropped = 0; this._steals = 0;
  }
  get config() { return { ...this._config }; }
  get nextTime() { return this._queue.items[0]?.time ?? Infinity; }
  get stats() { return { groups: this._groups.size, active: this._active, queued: this._queue.items.length,
    reservedEvents: this._children.size * 2, droppedAdditions: this._dropped, steals: this._steals }; }
  configure(config) { this._config = sanitizeMidiNoteEffects(config, this._config); return this.config; }
  activePitches(channel, sourceNote) {
    const pitches = new Set();
    for (const group of this._groups.values()) if (group.channel === channel && group.note === sourceNote) {
      for (const child of group.children) if (child.active) pitches.add(child.note);
    }
    return [...pitches];
  }
  _at(time) { return Number.isFinite(time) ? Math.max(0, this._time, time) : null; }
  _input(channel, note) { return Number.isInteger(channel) && channel >= 0 && channel <= 4095 && Number.isInteger(note) && note >= 0 && note <= 127; }
  _matching(channel, note, meta) { return meta?.key === undefined ? [this._fifo, `${channel}:${note}`] : [this._keys, meta.key]; }
  _schedule(child, type, time) { return this._queue.add({ child, type, time, serial: ++this._serial, index: -1 }); }
  _forget(group) {
    this._groups.delete(group.id);
    const index = group.matches.indexOf(group); if (index >= 0) group.matches.splice(index, 1);
    if (!group.matches.length) group.matchMap.delete(group.matchKey);
  }
  _finish(child, time) {
    this._queue.remove(child.on); this._queue.remove(child.off);
    child.on = child.off = null;
    if (child.active) {
      child.active = false; this._active--;
      this.emit({ type: 'noteOff', channel: child.group.channel, note: child.note, velocity: 0,
        time, id: child.id, meta: child.group.meta, release: true, releaseCount: 1 });
    }
    this._children.delete(child.id); this._optional.delete(child.id); child.group.children.delete(child);
    if (child.group.released && !child.group.children.size) this._forget(child.group);
  }
  _remove(group, time) {
    group.released = true;
    for (const child of [...group.children]) this._finish(child, time);
    this._forget(group);
  }
  _room(time) {
    while (this._children.size * 2 + 2 > this.maxEvents) {
      const optional = this._optional.values().next().value;
      if (optional) { this._dropped++; this._finish(optional, time); }
      else { const oldest = this._groups.values().next().value; if (!oldest) break; this._steals++; this._remove(oldest, time); }
    }
  }
  noteOn(channel, note, velocity, time, meta = {}) {
    if (!this._input(channel, note) || !Number.isFinite(velocity)) return null;
    if (velocity <= 0) { this.noteOff(channel, note, time, meta); return null; }
    const at = this._at(time); if (at === null) return null; this.advance(at);
    const expanded = midiNoteEffectChildren(this._config, note, velocity, { drums: typeof meta?.drums === 'boolean' ? meta.drums : channel % 16 === 9 });
    while (this._groups.size >= this.maxGroups) { this._steals++; this._remove(this._groups.values().next().value, at); }
    if (expanded.length) this._room(at);
    const [matchMap, matchKey] = this._matching(channel, note, meta), matches = matchMap.get(matchKey) ?? [];
    const group = { id: ++this._serial, channel, note, time: at, meta: { ...meta }, children: new Set(), released: false, matchMap, matchKey, matches };
    matches.push(group); matchMap.set(matchKey, matches); this._groups.set(group.id, group);
    for (const [index, event] of expanded.entries()) {
      if (this._children.size * 2 + 2 > this.maxEvents) { this._dropped++; continue; }
      const child = { ...event, id: ++this._serial, group, active: false, on: null, off: null };
      group.children.add(child); this._children.set(child.id, child); if (index) this._optional.set(child.id, child);
      child.on = this._schedule(child, 'noteOn', at + event.delaySeconds);
      if (Number.isFinite(event.gateSeconds)) child.off = this._schedule(child, 'noteOff', at + event.delaySeconds + event.gateSeconds);
    }
    this.advance(at); return group.id;
  }
  noteOff(channel, note, time, meta = {}) {
    if (!this._input(channel, note)) return false;
    const at = this._at(time); if (at === null) return false; this.advance(at);
    const [map, key] = this._matching(channel, note, meta), group = map.get(key)?.find(item => !item.released);
    if (!group) return false;
    group.released = true;
    for (const child of group.children) {
      const off = at + child.delaySeconds;
      if (!child.off || off < child.off.time) { this._queue.remove(child.off); child.off = this._schedule(child, 'noteOff', off); }
    }
    if (!group.children.size) this._forget(group);
    this.advance(at); return true;
  }
  advance(time) {
    const at = this._at(time); if (at === null) return;
    this._time = at;
    while (this.nextTime <= at) {
      const event = this._queue.pop(), child = event.child;
      if (event.type === 'noteOff') { child.off = null; this._finish(child, event.time); }
      else {
        child.on = null; child.active = true; this._active++;
        this.emit({ type: 'noteOn', channel: child.group.channel, note: child.note, velocity: child.velocity,
          time: event.time, id: child.id, meta: child.group.meta });
      }
    }
  }
  clear(time, predicate = () => true) {
    const at = this._at(time); if (at === null) return;
    for (const group of [...this._groups.values()]) if (predicate(group.meta)) this._remove(group, at);
    this.advance(at);
  }
}

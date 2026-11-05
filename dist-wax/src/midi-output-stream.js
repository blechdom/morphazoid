/** Audio-thread MIDI events -> one timestamped Web MIDI destination.
 * No animation/timer clock: use the audio device's presentation timeline.
 */
const MAX_EVENTS = 16384;
const MAX_VOICES = 8192;
const byte = value => Number.isInteger(value) && value >= 0 && value <= 127;
const channel = value => Number.isInteger(value) && value >= 0 && value < 16;
const emptyState = () => ({ voices: new Map(), pedals: new Map(), releases: new Map(), sourceReleases: new Map() });
const copyState = state => ({ voices: new Map(state.voices), pedals: new Map(state.pedals),
  releases: new Map(state.releases), sourceReleases: new Map(state.sourceReleases) });
const order = (a, b) => a.at - b.at || a.originalAt - b.originalAt || a.serial - b.serial;

export function audioMidiTimestamp(context, audioTime, now) {
  if (!Number.isFinite(audioTime) || !Number.isFinite(now)) return null;
  try {
    const stamp = context?.getOutputTimestamp?.();
    if (Number.isFinite(stamp?.contextTime) && stamp.contextTime >= 0
      && Number.isFinite(stamp.performanceTime) && stamp.performanceTime > 0) {
      return stamp.performanceTime + (audioTime - stamp.contextTime) * 1000;
    }
  } catch { /* Older embedded browsers can expose an unavailable timestamp API. */ }
  if (!Number.isFinite(context?.currentTime)) return null;
  const latency = Math.max(0, Number(context.baseLatency) || 0) + Math.max(0, Number(context.outputLatency) || 0);
  return now + (audioTime - context.currentTime + latency) * 1000;
}

function midiBytes(data) {
  if (!Array.isArray(data) && !ArrayBuffer.isView(data)) return null;
  const bytes = Array.from(data), kind = bytes[0] >> 4;
  if (kind < 8 || kind > 14 || bytes.length !== (kind === 12 || kind === 13 ? 2 : 3)
    || !bytes.slice(1).every(byte)) return null;
  return bytes;
}

export class MidiOutputStream {
  constructor({ manager, runtime = globalThis, onStatus = () => {}, maxLateMs = 8 } = {}) {
    this.manager = manager; this.runtime = runtime; this.onStatus = onStatus;
    this.maxLateMs = Math.max(0, Math.min(20, Number(maxLateMs) || 0));
    this.enabled = false; this.epoch = 0; this.disposed = false; this.serial = 0;
    this.pending = []; this.scheduled = new Map(); this.base = emptyState(); this.forecast = emptyState();
    this.error = ''; this.lateAttacks = 0; this.sentMessages = 0;
  }
  get stats() { return { enabled: this.enabled, epoch: this.epoch, error: this.error,
    lateAttacks: this.lateAttacks, sentMessages: this.sentMessages, pending: this.pending.length,
    held: this.forecast.voices.size }; }
  _now() { return this.runtime.performance?.now?.() ?? Date.now(); }
  _notify() { try { this.onStatus(this.stats); } catch { /* Status is not a musical dependency. */ } }
  _clear() {
    this.pending.length = 0; this.scheduled.clear(); this.base = emptyState(); this.forecast = emptyState();
    try { this.manager.clearOutput(); } catch { /* Still attempt release after disconnect. */ }
    try { this.manager.panic(); } catch { /* The selected device can disappear at any time. */ }
  }
  setEnabled(value) {
    const next = Boolean(value) && !this.disposed;
    if (this.enabled || next) this._clear();
    this.epoch++; this.enabled = next; this.error = ''; this._notify(); return this.epoch;
  }
  panic() { this._clear(); this.epoch++; this._notify(); return this.epoch; }
  _fail(message) {
    this._clear(); this.epoch++; this.enabled = false; this.error = message;
    this._notify(); return false;
  }
  _wire(event, bytes, suffix = 0) { return { key: `${event.serial}:${suffix}`, bytes, time: event.at }; }
  _apply(state, event) {
    const output = [], source = event.source;
    const emit = bytes => output.push(this._wire(event, bytes, output.length));
    const off = (key, voice) => { state.voices.delete(key); emit([0x80 | voice.channel, voice.note, 0]); };
    if (event.type === 'noteOn') {
      const key = `${source}\0${event.id}`;
      if (state.releases.get(key) >= event.originalAt || [...state.sourceReleases.values()].some(release =>
        release.producer === event.producer && (release.all || release.source === source)
        && (!channel(release.channel) || release.channel === event.channel)
        && (release.originalAt > event.originalAt || release.originalAt === event.originalAt && release.serial > event.serial))) return output;
      // A repeated batch must not create an unpaired second attack.
      if (state.voices.has(key)) return output;
      state.voices.set(key, { source, producer: event.producer, channel: event.channel, note: event.note });
      emit([0x90 | event.channel, event.note, event.velocity]);
    } else if (event.type === 'noteOff') {
      const key = `${source}\0${event.id}`, voice = state.voices.get(key);
      state.releases.set(key, event.originalAt);
      // No off for an attack skipped after a stall, or from an obsolete epoch.
      if (voice) off(key, voice);
    } else if (event.type === 'release') {
      state.sourceReleases.set(`${source}\0${event.channel ?? '*'}`, event);
      const matches = item => (event.all ? item.producer === event.producer : item.source === source)
        && (!channel(event.channel) || item.channel === event.channel);
      for (const [key, voice] of state.voices) if (matches(voice)) off(key, voice);
      const released = new Set();
      for (const [key, pedal] of state.pedals) if (matches(pedal)) {
        state.pedals.delete(key); released.add(`${pedal.channel}:${pedal.cc}`);
      }
      for (const pair of released) {
        const [ch, cc] = pair.split(':').map(Number);
        if (![...state.pedals.values()].some(pedal => pedal.channel === ch && pedal.cc === cc && pedal.value >= 64)) emit([0xb0 | ch, cc, 0]);
      }
    } else {
      const bytes = event.data;
      if ((bytes[0] & 0xf0) === 0xb0 && [64, 66].includes(bytes[1])) {
        const key = `${source}\0${bytes[0] & 15}:${bytes[1]}`;
        if (bytes[2] >= 64) state.pedals.set(key, { source, producer: event.producer, channel: bytes[0] & 15, cc: bytes[1], value: bytes[2] });
        else state.pedals.delete(key);
      }
      emit(bytes);
    }
    return output;
  }
  _settle(now) {
    let count = 0;
    while (count < this.pending.length && this.pending[count].at <= now) this._apply(this.base, this.pending[count++]);
    if (count) this.pending.splice(0, count);
    for (const [key, message] of this.scheduled) if (message.time <= now) this.scheduled.delete(key);
    // Retain a short release watermark for cross-port/main-thread delivery
    // races: an already-released late attack must never become a stuck note.
    for (const state of [this.base, this.forecast]) {
      for (const [key, time] of state.releases) if (time < now - this.maxLateMs - 1) state.releases.delete(key);
      for (const [key, event] of state.sourceReleases) if (event.originalAt < now - this.maxLateMs - 1) state.sourceReleases.delete(key);
    }
  }
  _send(message) {
    if (this.manager.send(message.bytes, message.time) === false) throw new Error('MIDI output disconnected.');
    this.sentMessages++; this.scheduled.set(message.key, message);
  }
  push(batch, context, producer = 'instrument') {
    if (!this.enabled || this.disposed || batch?.epoch !== this.epoch) return false;
    if (batch.overflow || batch.error) return this._fail(batch.error || 'MIDI output paused: event capacity exceeded. Select the output again to resume.');
    if (context?.state && context.state !== 'running') return this._fail('MIDI output paused: audio clock interrupted. Select the output again to resume.');
    if (!Array.isArray(batch.events) || batch.events.length > 4096) return this._fail('Invalid MIDI event batch.');
    const now = this._now(); this._settle(now);
    // A device timestamp pair can refresh between calls. One mapping preserves
    // every event's audio-sample spacing and ordering within this batch.
    const audioOrigin = audioMidiTimestamp(context, 0, now);
    let added = [];
    for (const input of batch.events) {
      if (!input || typeof input.source !== 'string' || input.source.length > 256) continue;
      const deadline = Number.isFinite(audioOrigin) && Number.isFinite(input.time)
        ? audioOrigin + input.time * 1000 : NaN;
      if (!Number.isFinite(deadline) || deadline > now + 1000) return this._fail('MIDI output paused: invalid audio clock timestamp.');
      const event = { ...input, producer, source: `${producer}\0${input.source}`, all: input.source === '*',
        at: Math.max(now, deadline), originalAt: deadline, serial: ++this.serial };
      if (event.type === 'noteOn' || event.type === 'noteOff') {
        if (!channel(event.channel) || !byte(event.note) || !['string', 'number'].includes(typeof event.id)) continue;
        if (event.type === 'noteOn') {
          if (!byte(event.velocity) || event.velocity === 0) continue;
          if (deadline < now - this.maxLateMs) { this.lateAttacks++; continue; }
        }
      } else if (event.type === 'message') {
        event.data = midiBytes(input.data); if (!event.data) continue;
        // Voice messages must carry identity, so late attacks never escape the
        // matching-release ledger. Source panic cannot silence another producer.
        const kind = event.data[0] & 0xf0;
        if (kind === 0x80 || kind === 0x90) continue;
        if (kind === 0xb0 && [120, 123].includes(event.data[1])) {
          event.type = 'release'; event.channel = event.data[0] & 15;
        }
      } else if (event.type !== 'release') continue;
      added.push(event);
    }
    const refresh = current => {
      // Device delivery continues while the main thread validates and rebuilds
      // a batch. Only existing reservations may become part of the base state;
      // newly arrived events still need their first send, even when overdue.
      this._settle(current);
      added = added.filter(event => {
        if (event.type === 'noteOn' && event.originalAt < current - this.maxLateMs) {
          this.lateAttacks++; return false;
        }
        event.at = Math.max(current, event.originalAt); return true;
      });
      added.sort(order);
    };
    refresh(this._now());
    if (this.pending.length + added.length > MAX_EVENTS) return this._fail('MIDI output paused: pending event capacity exceeded.');
    if (!added.length) return true;
    const reorder = this.pending.length && order(added[0], this.pending.at(-1)) < 0;
    try {
      if (reorder) {
        // Separate worklet ports may arrive out of order. Rebuild only the
        // still-future reservations; never replay already delivered notes.
        while (added.length) {
          const pending = [...this.pending, ...added].sort(order);
          const forecast = copyState(this.base), plan = new Map();
          for (const event of pending) for (const message of this._apply(forecast, event)) plan.set(message.key, message);
          const replaces = [...this.scheduled].some(([key, sent]) => {
            const next = plan.get(key);
            return !next || next.time !== sent.time || next.bytes.length !== sent.bytes.length
              || next.bytes.some((value, index) => value !== sent.bytes[index]);
          });
          const current = this._now();
          if (this.pending[0]?.at <= current
            || added.some(event => event.type === 'noteOn' && event.originalAt < current - this.maxLateMs)) {
            // Restart only when a real boundary was crossed. Each pass settles
            // old events or drops stale attacks; elapsed time adds no delay.
            refresh(current); continue;
          }
          if (replaces) {
            if (this.manager.clearOutput() === false) return this._fail('MIDI output cannot cancel pending notes.');
            this.scheduled.clear();
          }
          this.pending = pending; this.forecast = forecast;
          for (const [key, message] of plan) if (!this.scheduled.has(key)) this._send(message);
          break;
        }
      } else {
        this.pending.push(...added);
        for (const event of added) for (const message of this._apply(this.forecast, event)) this._send(message);
      }
      if (this.forecast.voices.size > MAX_VOICES) return this._fail('MIDI output paused: held-note capacity exceeded.');
    } catch (error) { return this._fail(error?.message || 'MIDI output failed.'); }
    return true;
  }
  dispose() {
    if (this.disposed) return;
    this.setEnabled(false); this.disposed = true;
  }
}

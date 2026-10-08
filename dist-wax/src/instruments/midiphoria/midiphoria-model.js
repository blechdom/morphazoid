// Independent browser model inspired by Midiphoria's MIDI-controlled color field.
// Timestamps are monotonic seconds; this module owns no devices, timers or DOM.
export const DEFAULT_VISUALS = Object.freeze({
  attack: 0.02, decay: 0.15, sustain: 0.8, release: 0.45,
  velocity: true, color: true, invert: false, hueMode: 'static', hueSpeed: 0.12,
  trigger: 'all', channel: -1, mappedType: 'note', mappedNumber: 60, mappedChannel: 0,
});

const LIMIT = 256;
const MAPPING_KEYS = ['trigger', 'channel', 'mappedType', 'mappedNumber', 'mappedChannel'];
const numeric = value => (typeof value === 'number' || typeof value === 'string') && value !== ''
  && Number.isFinite(Number(value));
const clamp = (value, min, max, fallback = min) => Math.min(max, Math.max(min, numeric(value) ? Number(value) : fallback));
const byte = value => Number.isInteger(value) && value >= 0 && value <= 127;
const sourceName = value => typeof value === 'string' && value ? value.slice(0, 256) : 'midi';
const scopeKey = (sourceId, channel) => JSON.stringify([sourceId, channel]);
const noteKey = message => JSON.stringify([message.sourceId, message.channel, message.note]);

function optionsFor(partial, previous = DEFAULT_VISUALS) {
  const options = { ...previous };
  if (!partial || typeof partial !== 'object') return options;
  for (const key of ['attack', 'decay', 'release']) {
    if (key in partial) options[key] = clamp(partial[key], 0, 30, previous[key]);
  }
  for (const [key, low, high] of [['sustain', 0, 1], ['hueSpeed', 0, 2]]) {
    if (key in partial) options[key] = clamp(partial[key], low, high, previous[key]);
  }
  for (const key of ['velocity', 'color', 'invert']) {
    if (typeof partial[key] === 'boolean') options[key] = partial[key];
  }
  for (const [key, values] of [
    ['hueMode', ['static', 'rotate', 'activity']], ['trigger', ['all', 'mapped']],
    ['mappedType', ['note', 'cc']],
  ]) if (values.includes(partial[key])) options[key] = partial[key];
  for (const [key, low, high] of [['channel', -1, 15], ['mappedChannel', 0, 15], ['mappedNumber', 0, 127]]) {
    if (key in partial) options[key] = Math.round(clamp(partial[key], low, high, previous[key]));
  }
  return options;
}

function normalize(message) {
  if (!message || typeof message !== 'object') return null;
  if (!Number.isInteger(message.channel) || message.channel < 0 || message.channel > 15) return null;
  const result = { ...message, sourceId: sourceName(message.sourceId) };
  if (message.type === 'noteOn' || message.type === 'noteOff') {
    if (!byte(message.note)) return null;
    if (message.type === 'noteOn' && !numeric(message.velocity)) return null;
    result.velocity = Math.round(clamp(message.velocity, 0, 127));
    if (message.type === 'noteOn' && result.velocity === 0) result.type = 'noteOff';
  } else if (message.type === 'controlChange') {
    if (!byte(message.controller) || !numeric(message.value)) return null;
    result.value = Math.round(clamp(message.value, 0, 127));
  } else return null;
  return result;
}

function hueRgb(hue) {
  const sector = ((hue % 1 + 1) % 1) * 6;
  return [0, 4, 2].map(offset => clamp(Math.abs((sector + offset) % 6 - 3) - 1, 0, 1));
}

/** A global ADSR follows the strongest accepted note/CC, with scoped note ownership. */
export class MidiphoriaModel {
  constructor(options = {}) {
    this.options = optionsFor(options);
    this._notes = new Map();
    this._pedals = new Map();
    this._controllers = new Map();
    this._contributors = new Map();
    this._now = 0;
    this._hueOffset = 0;
    this._lastColor = [1, 1, 1];
    this._gate = false;
    this._target = 0;
    this._level = 0;
    this._segment = { phase: 'idle', start: 0, duration: 0, from: 0, to: 0 };
  }

  configure(partial, now = this._now) {
    this._advance(now);
    const previous = this.options;
    const next = optionsFor(partial, previous);
    this.options = next;
    if (MAPPING_KEYS.some(key => previous[key] !== next[key])) {
      this.panic(this._now);
      return { ...next };
    }
    if (previous.hueMode !== next.hueMode && next.hueMode === 'static') this._hueOffset = 0;
    const segment = this._segment;
    const timingKey = segment.phase;
    if (['attack', 'decay', 'release'].includes(timingKey) && previous[timingKey] !== next[timingKey]) {
      const remaining = segment.duration > 0
        ? clamp(1 - (this._now - segment.start) / segment.duration, 0, 1) : 0;
      this._start(timingKey, segment.to, next[timingKey] * remaining);
    }
    this._updateGate();
    if (this._gate && previous.sustain !== next.sustain) {
      this._retarget();
    }
    this._advance(this._now);
    return { ...next };
  }

  handleMessage(input, now = this._now) {
    const message = normalize(input);
    if (!message) return false;
    this._advance(now);
    this._rememberColor();
    const { sourceId, channel, type } = message;
    const scope = scopeKey(sourceId, channel);
    if (type === 'controlChange' && message.controller === 120) {
      if (message.synthetic && sourceId === 'web-midi:manager') this.panic(this._now);
      else this._releaseScope(sourceId, message.synthetic ? null : channel, true);
      return true;
    }
    if (type === 'controlChange' && message.controller === 123) {
      this._releaseScope(sourceId, channel, false);
      return true;
    }
    if (this.options.channel !== -1 && this.options.channel !== channel) return false;
    if (type === 'controlChange' && message.controller === 64) {
      if (message.value >= 64) {
        if (!this._pedals.has(scope) && this._pedals.size >= LIMIT) {
          const oldest = this._pedals.values().next().value;
          this._releasePedal(oldest.sourceId, oldest.channel);
        }
        this._pedals.set(scope, { sourceId, channel });
      } else this._releasePedal(sourceId, channel);
      this._updateGate();
    }
    const mapped = this.options.trigger === 'mapped';
    if (type === 'noteOn' || type === 'noteOff') {
      const key = noteKey(message);
      if (mapped && (this.options.mappedType !== 'note' || this.options.mappedNumber !== message.note
        || this.options.mappedChannel !== channel)) return false;
      if (type === 'noteOn') {
        const existing = this._notes.get(key);
        if (!existing && this._notes.size >= LIMIT) this._notes.delete(this._notes.keys().next().value);
        this._notes.set(key, { sourceId, channel, note: message.note, velocity: message.velocity,
          held: Math.min(127, (existing?.held ?? 0) + 1) });
        if (this.options.hueMode === 'activity') {
          const strength = this.options.velocity ? message.velocity / 127 : 1;
          this._hueOffset = (this._hueOffset + strength * this.options.hueSpeed * 0.1) % 1;
        }
      } else {
        const note = this._notes.get(key);
        if (!note) return false;
        note.held = message.synthetic ? 0 : Math.max(0, note.held - 1);
        if (!note.held && (message.synthetic || !this._pedals.has(scope))) this._notes.delete(key);
      }
      this._updateGate();
      return true;
    }
    if (!mapped || this.options.mappedType !== 'cc' || this.options.mappedNumber !== message.controller
      || this.options.mappedChannel !== channel) return message.controller === 64;
    if (message.value > 0) {
      if (!this._controllers.has(scope) && this._controllers.size >= LIMIT) {
        this._controllers.delete(this._controllers.keys().next().value);
      }
      this._controllers.set(scope, { sourceId, channel, value: message.value });
    } else this._controllers.delete(scope);
    this._updateGate();
    return true;
  }

  sample(now = this._now) {
    this._advance(now);
    this._rememberColor();
    const base = this.options.color ? this._lastColor : [1, 1, 1];
    const rgb = base.map(component => {
      const value = clamp(component * this._level, 0, 1);
      return this.options.invert ? 1 - value : value;
    });
    return { level: this._level, rgb, phase: this._segment.phase, hueOffset: this._hueOffset,
      activeNotes: Array.from(this._notes.values(), ({ note, velocity, channel, sourceId }) => (
        { note, velocity, channel, sourceId }
      )) };
  }

  panic(now = this._now) {
    this._advance(now);
    this._notes.clear();
    this._pedals.clear();
    this._controllers.clear();
    this._contributors.clear();
    this._hueOffset = 0;
    this._lastColor = [1, 1, 1];
    this._stop();
  }

  releaseSource(sourceId, now = this._now) {
    this._advance(now);
    this._rememberColor();
    this._releaseScope(sourceName(sourceId), null, false);
  }

  _releasePedal(sourceId, channel) {
    this._pedals.delete(scopeKey(sourceId, channel));
    for (const [key, note] of this._notes) {
      if (note.sourceId === sourceId && note.channel === channel && !note.held) this._notes.delete(key);
    }
  }

  _releaseScope(sourceId, channel, immediate) {
    const matches = entry => entry.sourceId === sourceId && (channel === null || entry.channel === channel);
    let ownedTail = false;
    for (const entry of this._contributors.values()) if (matches(entry)) ownedTail = true;
    for (const entries of [this._notes, this._pedals, this._controllers]) {
      for (const [key, entry] of entries) if (matches(entry)) entries.delete(key);
    }
    this._updateGate();
    if (immediate) {
      for (const [key, entry] of this._contributors) if (matches(entry)) this._contributors.delete(key);
      if (!this._gate && ownedTail && !this._contributors.size) this._stop();
    }
  }

  _stop() {
    this._gate = false;
    this._target = 0;
    this._level = 0;
    this._segment = { phase: 'idle', start: this._now, duration: 0, from: 0, to: 0 };
  }

  _updateGate() {
    let target = 0;
    const contributors = new Map();
    for (const note of this._notes.values()) {
      target = Math.max(target, this.options.velocity ? note.velocity / 127 : 1);
      contributors.set(scopeKey(note.sourceId, note.channel), note);
    }
    for (const entry of this._controllers.values()) {
      const level = this.options.velocity ? entry.value / 127 : Number(entry.value >= 64);
      target = Math.max(target, level);
      if (level) contributors.set(scopeKey(entry.sourceId, entry.channel), entry);
    }
    const wasGated = this._gate;
    const changed = target !== this._target;
    this._gate = target > 0;
    this._target = target;
    if (this._gate) {
      this._contributors = contributors;
      if (!wasGated) this._start('attack', target, this.options.attack);
      else if (changed) this._retarget();
    } else if (wasGated) this._start('release', 0, this.options.release);
    this._advance(this._now);
  }

  _retarget() {
    const segment = this._segment;
    if (segment.phase === 'attack' || segment.phase === 'decay') {
      const endpoint = segment.phase === 'attack' ? this._target : this._target * this.options.sustain;
      this._start(segment.phase, endpoint, Math.max(0, segment.start + segment.duration - this._now));
    } else if (segment.phase === 'sustain') {
      // Short ramps keep held-note velocity and sustain edits continuous.
      this._start('sustain', this._target * this.options.sustain, 0.02);
    }
  }

  _start(phase, to, duration, start = this._now) {
    this._segment = { phase, start, duration, from: this._level, to: clamp(to, 0, 1) };
  }

  _advance(now) {
    const time = Math.max(this._now, clamp(now, 0, 1e12, this._now));
    if (this.options.hueMode === 'rotate') {
      this._hueOffset = (this._hueOffset + (time - this._now) * this.options.hueSpeed) % 1;
    }
    this._now = time;
    // One jump can traverse attack, decay and sustain (or release and idle).
    for (let step = 0; step < 4; step += 1) {
      const segment = this._segment;
      if (segment.phase === 'idle') break;
      const fraction = segment.duration ? clamp((time - segment.start) / segment.duration, 0, 1) : 1;
      this._level = clamp(segment.from + (segment.to - segment.from) * fraction, 0, 1);
      if (fraction < 1) break;
      const boundary = segment.start + segment.duration;
      if (segment.phase === 'attack') this._start('decay', this._target * this.options.sustain, this.options.decay, boundary);
      else if (segment.phase === 'decay') this._start('sustain', this._target * this.options.sustain, 0, boundary);
      else if (segment.phase === 'release') { this._stop(); this._contributors.clear(); break; }
      else break;
    }
  }

  _rememberColor() {
    if (this._notes.size) {
      const sum = [0, 0, 0];
      let total = 0;
      for (const note of this._notes.values()) {
        const weight = this.options.velocity ? note.velocity / 127 : 1;
        const color = hueRgb(note.note / 128 + this._hueOffset);
        for (let axis = 0; axis < 3; axis += 1) sum[axis] += color[axis] * weight;
        total += weight;
      }
      this._lastColor = sum.map(component => total > 0 ? component / total : 0);
    } else if (this._gate && this._controllers.size) this._lastColor = [1, 1, 1];
  }
}

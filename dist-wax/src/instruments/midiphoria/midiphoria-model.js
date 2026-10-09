// Independent browser model inspired by Midiphoria's MIDI-controlled color field.
// Timestamps are monotonic seconds; this module owns no devices, timers or DOM.
export const DEFAULT_VISUALS = Object.freeze({
  attack: 0.02, decay: 0.15, sustain: 0.8, release: 0.45,
  velocity: true, color: true, invert: false, hueMode: 'static', hueSpeed: 0.12,
  trigger: 'all', channel: -1, mappedType: 'note', mappedNumber: 60, mappedChannel: 0,
});

const CONTROL_LIMIT = 256;
export const MIDIPHORIA_NOTE_LIMIT = 4096;
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
    // Instance ownership and linked FIFO queues preserve repeated attacks at one pitch.
    this._noteKeys = new Map();
    this._scopes = new Map();
    this._pitchCounts = new Uint32Array(128);
    this._pitchVelocities = new Uint32Array(128);
    this._noteVelocities = new Uint32Array(128);
    this._controllerValues = new Uint32Array(128);
    this._nextNoteId = 1;
    this.droppedNotes = 0;
    this.onNoteEvent = typeof options?.onNoteEvent === 'function' ? options.onNoteEvent : null;
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
    this._updateGate(previous.velocity !== next.velocity ? this._scopes.keys() : []);
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
        if (!this._pedals.has(scope) && this._pedals.size >= CONTROL_LIMIT) {
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
        if (this._notes.size >= MIDIPHORIA_NOTE_LIMIT) {
          this.droppedNotes += 1;
          return false;
        }
        const instance = this._addNote(message, key, scope);
        if (this.options.hueMode === 'activity') {
          const strength = this.options.velocity ? message.velocity / 127 : 1;
          this._hueOffset = (this._hueOffset + strength * this.options.hueSpeed * 0.1) % 1;
        }
        this._updateGate([scope]);
        this._emitNote('noteOn', instance);
      } else {
        const group = this._noteKeys.get(key);
        if (!group) return false;
        if (message.synthetic) {
          for (const instance of group.instances) this._removeNote(instance);
        } else {
          const instance = group.head;
          if (!instance) return false;
          this._unholdNote(instance);
          if (!this._pedals.has(scope)) this._removeNote(instance);
        }
        this._updateGate([scope]);
      }
      return true;
    }
    if (!mapped || this.options.mappedType !== 'cc' || this.options.mappedNumber !== message.controller
      || this.options.mappedChannel !== channel) return message.controller === 64;
    const changedScopes = [scope];
    if (message.value > 0 && !this._controllers.has(scope) && this._controllers.size >= CONTROL_LIMIT) {
      const oldest = this._controllers.keys().next().value;
      this._setController(oldest, null);
      changedScopes.push(oldest);
    }
    this._setController(scope, message.value > 0 ? { sourceId, channel, value: message.value } : null);
    this._updateGate(changedScopes);
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
      activeNotes: Array.from(this._notes.values(), ({ id, note, velocity, channel, sourceId }) => (
        { id, note, velocity, channel, sourceId }
      )) };
  }

  panic(now = this._now) {
    this._advance(now);
    for (const instance of this._notes.values()) this._removeNote(instance);
    this._noteKeys.clear();
    this._scopes.clear();
    this._controllerValues.fill(0);
    this.droppedNotes = 0;
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

  _emitNote(type, instance) {
    // A renderer or observer must not be able to interrupt MIDI state cleanup.
    try {
      this.onNoteEvent?.({ type, id: instance.id, sourceId: instance.sourceId, channel: instance.channel,
        note: instance.note, velocity: instance.velocity, time: this._now });
    } catch { /* Observers are outside the model's state contract. */ }
  }

  _scope(sourceId, channel) {
    const key = scopeKey(sourceId, channel);
    let scope = this._scopes.get(key);
    if (!scope) {
      scope = { sourceId, channel, notes: new Set(), controller: 0 };
      this._scopes.set(key, scope);
    }
    return scope;
  }

  _addNote(message, key, scope) {
    let group = this._noteKeys.get(key);
    if (!group) {
      group = { head: null, tail: null, instances: new Set() };
      this._noteKeys.set(key, group);
    }
    const instance = { id: this._nextNoteId++, sourceId: message.sourceId, channel: message.channel,
      note: message.note, velocity: message.velocity, held: true, key, scope,
      previousHeld: group.tail, nextHeld: null };
    if (group.tail) group.tail.nextHeld = instance;
    else group.head = instance;
    group.tail = instance;
    group.instances.add(instance);
    this._notes.set(instance.id, instance);
    this._scope(message.sourceId, message.channel).notes.add(instance);
    this._pitchCounts[instance.note] += 1;
    this._pitchVelocities[instance.note] += instance.velocity;
    this._noteVelocities[instance.velocity] += 1;
    return instance;
  }

  _unholdNote(instance) {
    if (!instance.held) return;
    const group = this._noteKeys.get(instance.key);
    if (instance.previousHeld) instance.previousHeld.nextHeld = instance.nextHeld;
    else group.head = instance.nextHeld;
    if (instance.nextHeld) instance.nextHeld.previousHeld = instance.previousHeld;
    else group.tail = instance.previousHeld;
    instance.previousHeld = null;
    instance.nextHeld = null;
    instance.held = false;
  }

  _removeNote(instance) {
    this._unholdNote(instance);
    this._notes.delete(instance.id);
    const group = this._noteKeys.get(instance.key);
    group.instances.delete(instance);
    if (!group.instances.size) this._noteKeys.delete(instance.key);
    const scope = this._scopes.get(instance.scope);
    scope.notes.delete(instance);
    if (!scope.notes.size && !scope.controller) this._scopes.delete(instance.scope);
    this._pitchCounts[instance.note] -= 1;
    this._pitchVelocities[instance.note] -= instance.velocity;
    this._noteVelocities[instance.velocity] -= 1;
    this._emitNote('noteOff', instance);
  }

  _setController(key, entry) {
    const previous = this._controllers.get(key);
    if (previous) this._controllerValues[previous.value] -= 1;
    if (entry) {
      this._controllers.set(key, entry);
      this._controllerValues[entry.value] += 1;
      this._scope(entry.sourceId, entry.channel).controller = entry.value;
    } else {
      this._controllers.delete(key);
      const scope = this._scopes.get(key);
      if (scope) {
        scope.controller = 0;
        if (!scope.notes.size) this._scopes.delete(key);
      }
    }
  }

  _releasePedal(sourceId, channel) {
    const key = scopeKey(sourceId, channel);
    this._pedals.delete(key);
    const scope = this._scopes.get(key);
    if (scope) for (const instance of scope.notes) if (!instance.held) this._removeNote(instance);
    this._updateGate([key]);
  }

  _releaseScope(sourceId, channel, immediate) {
    const matches = entry => entry.sourceId === sourceId && (channel === null || entry.channel === channel);
    let ownedTail = false;
    for (const entry of this._contributors.values()) if (matches(entry)) ownedTail = true;
    const changedScopes = [];
    // At most sixteen MIDI channels belong to a source; no scan of other inputs.
    for (let number = 0; number < 16; number += 1) {
      if (channel !== null && channel !== number) continue;
      const key = scopeKey(sourceId, number);
      const scope = this._scopes.get(key);
      if (scope) for (const instance of scope.notes) this._removeNote(instance);
      this._setController(key, null);
      this._pedals.delete(key);
      changedScopes.push(key);
    }
    this._updateGate(changedScopes);
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

  _updateGate(changedScopes = []) {
    let strongest = 0;
    for (let value = 127; value > 0; value -= 1) {
      if (this._noteVelocities[value] || this._controllerValues[value]) { strongest = value; break; }
    }
    const target = this.options.velocity ? strongest / 127 : Number(this._notes.size > 0 || strongest >= 64);
    const wasGated = this._gate;
    const changed = target !== this._target;
    this._gate = target > 0;
    this._target = target;
    if (this._gate) {
      if (!wasGated) this._contributors.clear();
      // Update only touched scopes; retain the final contributors through a release tail.
      for (const key of changedScopes) {
        const scope = this._scopes.get(key);
        if (scope && (scope.notes.size || (this.options.velocity ? scope.controller > 0 : scope.controller >= 64))) {
          this._contributors.set(key, { sourceId: scope.sourceId, channel: scope.channel });
        } else this._contributors.delete(key);
      }
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
      // Fixed pitch bins keep incoming-event work independent of polyphony.
      for (let note = 0; note < 128; note += 1) {
        const weight = this.options.velocity ? this._pitchVelocities[note] : this._pitchCounts[note];
        if (!weight) continue;
        const color = hueRgb(note / 128 + this._hueOffset);
        for (let axis = 0; axis < 3; axis += 1) sum[axis] += color[axis] * weight;
        total += weight;
      }
      this._lastColor = sum.map(component => total > 0 ? component / total : 0);
    } else if (this._gate && this._controllers.size) this._lastColor = [1, 1, 1];
  }
}

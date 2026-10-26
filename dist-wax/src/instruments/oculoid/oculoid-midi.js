import { clampEye, normalizeOculoid } from "./oculoid-model.js";

const MAX_HELD = 24;
const MAX_SOURCES = 32;

function scopeFor(message) {
  return `${String(message?.sourceId ?? "midi").slice(0, 128)}:${clampEye(message?.channel, 0, 15, 0)}`;
}

function noteFor(message) {
  return Number.isInteger(message?.note) && message.note >= 0 && message.note <= 127
    ? message.note : null;
}

function noteKey(message) { return `${scopeFor(message)}:${message.note}`; }

/** A monophonic eye follows the most recent held note. Each input/channel
 * retains its own gates and pedal; losing a device cannot strand its gaze. */
export class OculoidMidiState {
  constructor() {
    this.notes = new Map();
    this.sustain = new Set();
    this.bends = new Map();
  }

  clear() {
    this.notes.clear();
    this.sustain.clear();
    this.bends.clear();
  }

  handle(message) {
    const scope = scopeFor(message);
    const note = noteFor(message);
    if (message?.type === "noteOn" || message?.type === "noteOff") {
      if (note === null) return false;
      const key = noteKey(message), velocity = clampEye(message.velocity, 0, 127, 0);
      if (message.type === "noteOn" && velocity > 0) {
        this.notes.delete(key);
        if (this.notes.size === MAX_HELD) this.notes.delete(this.notes.keys().next().value);
        this.notes.set(key, { scope, note, velocity, down: true });
      } else if (this.sustain.has(scope) && this.notes.has(key)) {
        this.notes.get(key).down = false;
      } else this.notes.delete(key);
      return true;
    }
    if (message?.type === "pitchBend") {
      if (!this.bends.has(scope) && this.bends.size === MAX_SOURCES) {
        this.bends.delete(this.bends.keys().next().value);
      }
      this.bends.set(scope, clampEye(message.normalized, -1, 1, 0));
      return true;
    }
    if (message?.type !== "controlChange") return false;
    const cc = message.controller;
    if (cc === 64) {
      if (clampEye(message.value, 0, 127, 0) >= 64) {
        if (this.sustain.size === MAX_SOURCES && !this.sustain.has(scope)) {
          this.sustain.delete(this.sustain.values().next().value);
        }
        this.sustain.add(scope);
      } else {
        this.sustain.delete(scope);
        for (const [key, held] of this.notes) {
          if (held.scope === scope && !held.down) this.notes.delete(key);
        }
      }
      return true;
    }
    if (![120, 121, 123].includes(cc)) return false;
    // The manager's synthetic panic may refer to one disconnected input or
    // to the manager itself when no hardware input was ever attached.
    const all = message.synthetic && message.sourceId === "web-midi:manager";
    const matching = candidate => all || (message.synthetic
      ? candidate.startsWith(`${String(message.sourceId).slice(0, 128)}:`)
      : candidate === scope);
    for (const [key, held] of this.notes) {
      if (matching(held.scope) && (cc !== 121 || !held.down)) this.notes.delete(key);
    }
    for (const key of this.sustain) if (matching(key)) this.sustain.delete(key);
    for (const key of this.bends.keys()) if (matching(key)) this.bends.delete(key);
    return true;
  }

  performance(config) {
    const base = normalizeOculoid(config);
    const held = [...this.notes.values()].at(-1);
    if (!held) return base;
    const bend = this.bends.get(held.scope) ?? 0;
    const semitones = held.note - 69 + 2 * bend;
    return {
      ...base,
      // MIDI supplies a reference pitch, never quantizes the manual eye.
      midiHz: clampEye(440 * 2 ** (semitones / 12), 25, 3000),
      gazeX: clampEye(base.gazeX + ((held.note % 12) - 5.5) * 0.12, -1, 1),
      gazeY: clampEye(base.gazeY + (held.note - 60) * 0.017, -1, 1),
      pupil: clampEye(base.pupil + (held.velocity / 127) * 0.26 - 0.04, 0, 1),
    };
  }
}

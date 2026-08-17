const clamp = (value, minimum, maximum, fallback = minimum) => {
  const number = Number(value);
  return Math.min(maximum, Math.max(minimum, Number.isFinite(number) ? number : fallback));
};

const sourceId = (event) => String(event?.sourceId ?? "midi");
const channel = (event) => Math.round(clamp(event?.channel, 0, 15, 0));
const scopeKey = (event) => `${sourceId(event)}:${channel(event)}`;
const noteKey = (event) => `${scopeKey(event)}:${event?.note ?? 0}`;

export const SHAPE_MIDI_ROOT_NOTE = 60;

export const SHAPE_MIDI_MACRO_LABELS = Object.freeze([
  "Sides",
  "Roundness",
  "Stretch",
  "Skew",
  "Playhead speed",
  "Rotation",
  "Sound character",
  "Stereo width",
]);

export const SHAPE_MIDI_PAD_ACTIONS = Object.freeze([
  "sound-sine",
  "sound-percussion",
  "sound-shepard",
  "sound-fm",
  "sound-pm",
  "playhead-trace",
  "playhead-scan",
  "playhead-radial",
  "toggle-play",
  "toggle-rotation",
  "reverse",
  "toggle-motion",
  "toggle-star",
  "reset-form",
  "remove-head",
  "add-head",
]);

export function shapeMidiNoteRatio(note, bendSemitones = 0, rootNote = SHAPE_MIDI_ROOT_NOTE) {
  const semitones = clamp(note, 0, 127, rootNote)
    - clamp(rootNote, 0, 127, SHAPE_MIDI_ROOT_NOTE)
    + clamp(bendSemitones, -24, 24, 0);
  return 2 ** (semitones / 12);
}

export function shapeMidiMacroAction(index, normalizedValue, soundMode = "sine") {
  const slot = Math.round(Number(index));
  const value = clamp(normalizedValue, 0, 1, 0);
  if (slot === 0) return Object.freeze({ type: "range", id: "sides", value: Math.round(1 + value * 31) });
  if (slot === 1) return Object.freeze({ type: "range", id: "curvature", value: -1 + value * 2 });
  if (slot === 2) return Object.freeze({ type: "range", id: "aspect", value: -2 + value * 4 });
  if (slot === 3) return Object.freeze({ type: "range", id: "skew", value: -2 + value * 4 });
  if (slot === 4) return Object.freeze({ type: "range", id: "speed", value });
  if (slot === 5) return Object.freeze({ type: "range", id: "rotation", value: -180 + value * 360 });
  if (slot === 6) {
    const character = {
      percussion: { id: "percussionAttackNoise", value },
      shepard: { id: "shepardWidth", value: 2 + value * 6 },
      fm: { id: "fmIndex", value: value * 12 },
      pm: { id: "pmIndex", value: value * 8 },
      sine: { id: "pitchRange", value: value * 6 },
    }[soundMode] ?? { id: "pitchRange", value: value * 6 };
    return Object.freeze({ type: "range", ...character });
  }
  if (slot === 7) return Object.freeze({ type: "range", id: "stereoWidth", value });
  return null;
}

export function shapeMidiPadAction(index) {
  const action = SHAPE_MIDI_PAD_ACTIONS[Math.round(Number(index))];
  return action ? Object.freeze({ type: "command", command: action }) : null;
}

/**
 * Musical-note overlay for Shape. With no held note the geometric synth
 * returns to its original pitch and gain instead of becoming a gated synth.
 */
export class ShapeMidiPerformance {
  constructor({ rootNote = SHAPE_MIDI_ROOT_NOTE, bendRangeSemitones = 2 } = {}) {
    this.rootNote = Math.round(clamp(rootNote, 0, 127, SHAPE_MIDI_ROOT_NOTE));
    this.bendRangeSemitones = clamp(bendRangeSemitones, 0, 24, 2);
    this.events = [];
    this.sequence = 0;
    this.sustainScopes = new Set();
    this.sustain = false;
    this.expression = 1;
    this.bendNormalized = 0;
  }

  noteOn(event) {
    const key = noteKey(event);
    const existing = this.events.find((entry) => entry.key === key);
    if (existing) {
      existing.count += 1;
      existing.velocity = clamp(event.velocity, 1, 127, 127);
      existing.held = true;
      existing.order = ++this.sequence;
    } else {
      this.events.push({
        key,
        scope: scopeKey(event),
        sourceId: sourceId(event),
        channel: channel(event),
        note: Math.round(clamp(event.note, 0, 127, this.rootNote)),
        velocity: clamp(event.velocity, 1, 127, 127),
        count: 1,
        held: true,
        order: ++this.sequence,
      });
    }
  }

  noteOff(event) {
    const entry = this.events.find((item) => item.key === noteKey(event));
    if (!entry) return;
    entry.count = Math.max(0, entry.count - 1);
    entry.held = entry.count > 0;
    if (!entry.held && !this.sustainScopes.has(entry.scope)) {
      this.events = this.events.filter((item) => item !== entry);
    }
  }

  releaseSustain(scope = null) {
    this.events = this.events.filter(
      (entry) => entry.held || (scope !== null && entry.scope !== scope),
    );
  }

  clearScope(event, { respectSustain = false } = {}) {
    const scope = scopeKey(event);
    if (!respectSustain || !this.sustainScopes.has(scope)) {
      this.events = this.events.filter((entry) => entry.scope !== scope);
      return;
    }
    for (const entry of this.events) {
      if (entry.scope !== scope) continue;
      entry.count = 0;
      entry.held = false;
    }
  }

  handle(event) {
    if (event?.type === "noteOn" && Number(event.velocity) > 0) this.noteOn(event);
    else if (event?.type === "noteOff" || (event?.type === "noteOn" && Number(event.velocity) <= 0)) this.noteOff(event);
    else if (event?.type === "pitchBend") this.bendNormalized = clamp(event.normalized, -1, 1, 0);
    else if (event?.type === "controlChange") {
      const controller = Math.round(Number(event.controller));
      const value = clamp(event.value, 0, 127, 0);
      if (controller === 11) this.expression = value / 127;
      else if (controller === 64) {
        const scope = scopeKey(event);
        const next = value >= 64;
        if (next) this.sustainScopes.add(scope);
        else if (this.sustainScopes.delete(scope)) this.releaseSustain(scope);
        this.sustain = this.sustainScopes.size > 0;
      } else if (controller === 120) {
        this.clearScope(event);
        if (event.synthetic) this.sustainScopes.delete(scopeKey(event));
        this.sustain = this.sustainScopes.size > 0;
      } else if (controller === 123) {
        this.clearScope(event, { respectSustain: true });
      } else if (controller === 121) {
        this.expression = 1;
        this.bendNormalized = 0;
        const scope = scopeKey(event);
        if (this.sustainScopes.delete(scope)) this.releaseSustain(scope);
        this.sustain = this.sustainScopes.size > 0;
      }
    }
    return this.snapshot();
  }

  snapshot() {
    const selected = this.events.reduce(
      (latest, entry) => (!latest || entry.order > latest.order ? entry : latest),
      null,
    );
    if (!selected) {
      return Object.freeze({
        note: null,
        pitchRatio: 1,
        gain: 1,
        expression: this.expression,
        sustain: this.sustain,
      });
    }
    const bend = this.bendNormalized * this.bendRangeSemitones;
    return Object.freeze({
      note: selected.note,
      pitchRatio: shapeMidiNoteRatio(selected.note, bend, this.rootNote),
      gain: selected.velocity / 127 * this.expression,
      expression: this.expression,
      sustain: this.sustain,
    });
  }

  reset() {
    this.events = [];
    this.sustainScopes.clear();
    this.sustain = false;
    this.expression = 1;
    this.bendNormalized = 0;
    return this.snapshot();
  }
}

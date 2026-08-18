export const WAX_OUTPUT_MODES = Object.freeze(["audio", "midi", "both"]);

export const WAX_CLOCK_DIVISIONS = Object.freeze({
  "1/4": 1,
  "1/8": 0.5,
  "1/16": 0.25,
  "1/32": 0.125,
});

const DEFAULT_PATTERN = Object.freeze([0, 3, 7, 10, 12, 7, 5, 3]);
const DEFAULT_DRUM_PATTERN = Object.freeze([36, 42, 38, 42, 36, 46, 38, 42]);

function finite(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function clamp(value, minimum, maximum) {
  return Math.min(maximum, Math.max(minimum, value));
}

function byte(value) {
  return clamp(Math.round(finite(value, 0)), 0, 127);
}

function channelNibble(value) {
  return clamp(Math.round(finite(value, 0)), 0, 15);
}

export function midiNoteToFrequency(note, concertA = 440) {
  return finite(concertA, 440) * (2 ** ((finite(note, 69) - 69) / 12));
}

export function normalizedControlValue(normalized, {
  min = 0,
  max = 1,
  step = "any",
} = {}) {
  const minimum = finite(min, 0);
  const maximum = finite(max, 1);
  const low = Math.min(minimum, maximum);
  const high = Math.max(minimum, maximum);
  let value = low + clamp(finite(normalized, 0), 0, 1) * (high - low);
  const quantum = Number(step);
  if (Number.isFinite(quantum) && quantum > 0) {
    value = low + Math.round((value - low) / quantum) * quantum;
  }
  return clamp(value, low, high);
}

export function normalizeWaxRoutingState(value = {}, support = {}) {
  const roles = Array.isArray(support.roles) ? support.roles : ["instrument"];
  const canAudio = roles.includes("instrument") || roles.includes("audio-fx");
  const canMidi = roles.includes("midi-fx");
  const allowedModes = canAudio && canMidi
    ? WAX_OUTPUT_MODES
    : canMidi
      ? ["midi"]
      : ["audio"];
  const requestedMode = String(value.outputMode || "").toLowerCase();
  const outputMode = allowedModes.includes(requestedMode)
    ? requestedMode
    : canAudio
      ? "audio"
      : "midi";
  const division = Object.hasOwn(WAX_CLOCK_DIVISIONS, value.division)
    ? value.division
    : "1/16";

  return Object.freeze({
    outputMode,
    outputId: typeof value.outputId === "string" ? value.outputId : "",
    channel: channelNibble(value.channel ?? (support.noteMode === "drums" ? 9 : 0)),
    rootNote: byte(value.rootNote ?? (support.noteMode === "drums" ? 36 : 48)),
    division,
    gate: clamp(finite(value.gate, 0.72), 0.05, 0.98),
    hostSync: value.hostSync === undefined ? support.hostSync !== false : Boolean(value.hostSync),
  });
}

export function deriveCompanionNote({
  step = 0,
  rootNote = 48,
  noteMode = "melodic",
  routeSeed = 0,
} = {}) {
  const index = Math.max(0, Math.floor(finite(step, 0)));
  if (noteMode === "drums") {
    const note = DEFAULT_DRUM_PATTERN[(index + Math.abs(Math.floor(routeSeed))) % DEFAULT_DRUM_PATTERN.length];
    return byte(note + (byte(rootNote) - 36));
  }
  const interval = DEFAULT_PATTERN[(index + Math.abs(Math.floor(routeSeed))) % DEFAULT_PATTERN.length];
  return byte(byte(rootNote) + interval);
}

export function stableRouteSeed(routeId) {
  let hash = 0;
  for (const character of String(routeId || "morphazoid")) {
    hash = ((hash * 31) + character.codePointAt(0)) >>> 0;
  }
  return hash;
}

export function noteOnBytes(channel, note, velocity) {
  return Object.freeze([0x90 | channelNibble(channel), byte(note), Math.max(1, byte(velocity))]);
}

export function noteOffBytes(channel, note, velocity = 0) {
  return Object.freeze([0x80 | channelNibble(channel), byte(note), byte(velocity)]);
}

export function panicBytes(channel) {
  const status = 0xb0 | channelNibble(channel);
  return Object.freeze([
    Object.freeze([status, 64, 0]),
    Object.freeze([status, 123, 0]),
    Object.freeze([status, 120, 0]),
    Object.freeze([0xe0 | channelNibble(channel), 0, 64]),
  ]);
}

export class MidiClockTempoTracker {
  constructor({ sampleSize = 24 } = {}) {
    this.sampleSize = clamp(Math.round(finite(sampleSize, 24)), 6, 96);
    this.timestamps = [];
  }

  reset() {
    this.timestamps.length = 0;
  }

  ingest(timestamp) {
    const time = finite(timestamp, NaN);
    if (!Number.isFinite(time)) return null;
    const previous = this.timestamps.at(-1);
    if (previous !== undefined && (time <= previous || time - previous > 1000)) this.reset();
    this.timestamps.push(time);
    while (this.timestamps.length > this.sampleSize + 1) this.timestamps.shift();
    if (this.timestamps.length < 7) return null;
    const elapsed = this.timestamps.at(-1) - this.timestamps[0];
    const pulses = this.timestamps.length - 1;
    if (!(elapsed > 0)) return null;
    return clamp(60_000 / ((elapsed / pulses) * 24), 20, 400);
  }
}

export class PpqMidiOutputScheduler {
  constructor({
    send,
    clear = null,
    panic = null,
    now = () => globalThis.performance?.now?.() ?? Date.now(),
    horizonMs = 120,
  } = {}) {
    if (typeof send !== "function") throw new TypeError("A MIDI send callback is required");
    this.send = send;
    this.clear = typeof clear === "function" ? clear : null;
    this.panicCallback = typeof panic === "function" ? panic : null;
    this.now = now;
    this.horizonMs = clamp(finite(horizonMs, 120), 20, 500);
    this.enabled = false;
    this.state = normalizeWaxRoutingState({ outputMode: "midi" }, { roles: ["midi-fx"] });
    this.noteMode = "melodic";
    this.routeSeed = 0;
    this.lastPpq = null;
    this.lastScheduledStep = null;
    this.wasPlaying = false;
  }

  configure(value = {}, support = {}) {
    const previousChannel = this.state.channel;
    const previousDivision = this.state.division;
    this.state = normalizeWaxRoutingState({ ...this.state, ...value }, support);
    this.noteMode = support.noteMode || this.noteMode;
    this.routeSeed = stableRouteSeed(support.id || support.routeId || this.routeSeed);
    if (previousChannel !== this.state.channel || previousDivision !== this.state.division) {
      this.stop(previousChannel !== this.state.channel ? "channel-change" : "division-change");
    }
    return this.state;
  }

  setEnabled(enabled) {
    const next = Boolean(enabled);
    if (!next && this.enabled) this.stop("disabled");
    this.enabled = next;
    return next;
  }

  panic(reason = "panic") {
    try { this.clear?.(); } catch { /* A disconnected output is already silent. */ }
    if (this.panicCallback) {
      try { this.panicCallback(reason, this.state.channel); } catch { /* Keep transport safe. */ }
    } else {
      for (const message of panicBytes(this.state.channel)) {
        try { this.send(message); } catch { /* Keep sending remaining safety messages. */ }
      }
    }
  }

  stop(reason = "stop") {
    if (this.wasPlaying || this.lastScheduledStep !== null) this.panic(reason);
    this.wasPlaying = false;
    this.lastPpq = null;
    this.lastScheduledStep = null;
  }

  update(playhead = {}, eventFactory = null) {
    const playing = playhead.isPlaying === true;
    const ppq = finite(playhead.ppqPosition, NaN);
    const bpm = finite(playhead.bpm, NaN);
    if (!this.enabled || !playing || !Number.isFinite(ppq) || !(bpm > 0)) {
      if (this.wasPlaying && !playing) this.stop("transport-stop");
      return [];
    }

    const stepPpq = WAX_CLOCK_DIVISIONS[this.state.division];
    const millisecondsPerPpq = 60_000 / bpm;
    const horizonPpq = this.horizonMs / millisecondsPerPpq;
    const discontinuity = this.lastPpq !== null && (
      ppq < this.lastPpq - stepPpq * 0.5
      || ppq - this.lastPpq > Math.max(0.5, horizonPpq * 2, stepPpq * 2)
    );
    if (discontinuity) {
      this.panic("transport-seek");
      this.lastScheduledStep = null;
    }
    this.wasPlaying = true;
    this.lastPpq = ppq;

    const now = finite(this.now(), 0);
    const currentStep = Math.floor((ppq + 1e-7) / stepPpq);
    const firstStep = this.lastScheduledStep === null
      ? currentStep
      : Math.max(this.lastScheduledStep + 1, currentStep);
    const finalStep = Math.floor((ppq + horizonPpq + 1e-7) / stepPpq);
    const emitted = [];

    for (let step = firstStep; step <= finalStep; step += 1) {
      const targetPpq = step * stepPpq;
      const timestamp = now + Math.max(0, (targetPpq - ppq) * millisecondsPerPpq);
      const fallback = {
        note: deriveCompanionNote({
          step,
          rootNote: this.state.rootNote,
          noteMode: this.noteMode,
          routeSeed: this.routeSeed,
        }),
        velocity: step % 4 === 0 ? 112 : 88,
        channel: this.state.channel,
      };
      const supplied = typeof eventFactory === "function"
        ? eventFactory(step, { ...fallback, ppq: targetPpq, timestamp })
        : null;
      const event = { ...fallback, ...(supplied || {}) };
      if (event.skip) {
        this.lastScheduledStep = step;
        continue;
      }
      const channel = channelNibble(event.channel);
      const note = byte(event.note);
      const velocity = Math.max(1, byte(event.velocity));
      const noteOffAt = timestamp + stepPpq * this.state.gate * millisecondsPerPpq;
      this.send(noteOnBytes(channel, note, velocity), timestamp);
      this.send(noteOffBytes(channel, note, 0), noteOffAt);
      emitted.push(Object.freeze({ channel, note, noteOffAt, ppq: targetPpq, step, timestamp, velocity }));
      this.lastScheduledStep = step;
    }
    return emitted;
  }
}

import {
  FmDrumAudio,
  cloneDefaultFmDrumVoices,
} from "./fm-drums.js";
import { GraphSynthAudio } from "./graph-synth-audio.js";

const EPSILON = 1e-7;
const MAX_EVENTS_PER_WINDOW = 512;

const clamp = (value, minimum = 0, maximum = 1, fallback = minimum) => {
  const number = Number(value);
  return Math.min(maximum, Math.max(minimum, Number.isFinite(number) ? number : fallback));
};

const finite = (value, fallback = 0) => {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
};

function midiFrequency(note) {
  return 440 * 2 ** ((clamp(note, 0, 127, 60) - 69) / 12);
}
function hashString(value) {
  let hash = 2166136261;
  for (const character of String(value ?? "")) {
    hash ^= character.codePointAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function stepVelocity(step) {
  if (step === true) return 0.82;
  const value = Number(step);
  if (!Number.isFinite(value) || value <= 0) return 0;
  if (value <= 1) return clamp(value, 0.05, 1, 0.82);
  return clamp(value / 127, 0.05, 1, 0.82);
}

/**
 * Expand one projected timeline window into deterministic note attacks.
 *
 * The transport asks for small half-open beat windows. Keeping this pure makes
 * graph projection, scrubbing, loop wraps, and browser scheduling independently
 * testable while native AudioNodes remain lazy and gesture-gated.
 */
export function performanceEventsForWindow(
  clips,
  fromBeat,
  toBeat,
  { maximum = MAX_EVENTS_PER_WINDOW } = {},
) {
  const start = finite(fromBeat, 0);
  const end = Math.max(start, finite(toBeat, start));
  if (!Array.isArray(clips) || end - start <= EPSILON) return [];
  const events = [];

  for (const clip of clips) {
    const clipStart = finite(clip?.startBeat, 0);
    const clipEnd = Math.max(clipStart, finite(clip?.endBeat, clipStart));
    if (clipEnd <= start + EPSILON || clipStart >= end - EPSILON) continue;

    const pattern = clip?.pattern && typeof clip.pattern === "object" ? clip.pattern : {};
    const steps = Array.isArray(pattern.steps) && pattern.steps.length
      ? pattern.steps
      : [1];
    const stepBeats = Math.max(1 / 64, finite(pattern.stepBeats, 1));
    const cycleBeats = stepBeats * steps.length;
    const noteOffsets = Array.isArray(pattern.noteOffsets) && pattern.noteOffsets.length
      ? pattern.noteOffsets
      : [0];
    const firstStep = Math.max(0, Math.floor((start - clipStart) / stepBeats - EPSILON));
    const lastStep = Math.max(firstStep, Math.ceil((Math.min(end, clipEnd) - clipStart) / stepBeats));

    for (let absoluteStep = firstStep; absoluteStep < lastStep; absoluteStep += 1) {
      const beat = clipStart + absoluteStep * stepBeats;
      if (beat + EPSILON < start || beat >= end - EPSILON || beat >= clipEnd - EPSILON) continue;
      const patternIndex = absoluteStep % steps.length;
      const velocity = stepVelocity(steps[patternIndex]);
      if (velocity <= 0) continue;
      const noteOffset = finite(noteOffsets[patternIndex % noteOffsets.length], 0);
      events.push(Object.freeze({
        id: `${clip.id}:${absoluteStep}`,
        clipId: clip.id,
        sectionId: clip.sectionId,
        lane: Math.max(0, Math.floor(finite(clip.lane, 0))),
        role: clip.role ?? "voice",
        instrumentId: clip.instrumentId ?? "graph-synth",
        instrumentType: clip.instrumentType ?? "pitched",
        soundId: clip.soundId ?? clip.instrumentId ?? "graph-synth",
        patternId: clip.patternId ?? "pulse",
        beat,
        localBeat: beat - clipStart,
        cycle: Math.floor((absoluteStep * stepBeats) / cycleBeats),
        step: patternIndex,
        stepBeats,
        durationBeats: Math.min(stepBeats * 0.82, Math.max(1 / 64, clipEnd - beat)),
        note: clamp(finite(clip.rootNote, 60) + noteOffset, 0, 127, 60),
        velocity,
      }));
      if (events.length >= Math.max(1, Math.floor(finite(maximum, MAX_EVENTS_PER_WINDOW)))) {
        return events.sort((first, second) => first.beat - second.beat || first.lane - second.lane);
      }
    }
  }

  return events.sort((first, second) => (
    first.beat - second.beat
    || first.lane - second.lane
    || String(first.id).localeCompare(String(second.id))
  ));
}

const DRUM_INDEX_BY_HINT = Object.freeze({
  kick: 0,
  sub: 0,
  snare: 2,
  clap: 3,
  tom: 5,
  hat: 7,
  metal: 9,
  bell: 11,
  chime: 12,
  gong: 13,
  noise: 15,
});

function drumVoiceIndex(event) {
  const hint = `${event?.soundId ?? ""} ${event?.patternId ?? ""} ${event?.role ?? ""}`.toLowerCase();
  for (const [token, index] of Object.entries(DRUM_INDEX_BY_HINT)) {
    if (hint.includes(token)) return index;
  }
  const palette = [0, 7, 2, 7, 0, 9, 2, 8, 4, 7, 3, 7, 1, 10, 2, 15];
  return palette[(Math.max(0, event?.step ?? 0) + Math.max(0, event?.lane ?? 0) * 3) % palette.length];
}

function pitchedVoice(event, secondsPerBeat) {
  const sound = String(event?.soundId ?? event?.instrumentId ?? "graph-synth").toLowerCase();
  const identity = hashString(`${event?.instrumentId}:${sound}`);
  const voice = {
    frequency: midiFrequency(event?.note ?? 60),
    gain: clamp((event?.velocity ?? 0.8) * 0.2, 0.025, 0.24, 0.14),
    pan: clamp(((event?.lane ?? 0) % 5 - 2) * 0.28, -0.8, 0.8, 0),
    brightness: 0.48 + (identity % 37) / 100,
    attack: 0.004,
    decay: Math.max(0.06, finite(event?.durationBeats, 0.5) * secondsPerBeat),
    mode: "sine",
    waveform: "triangle",
    modulationIndex: 0,
    modulationRatio: 1.5,
  };

  if (sound.includes("bass") || event?.role === "bass") {
    return { ...voice, mode: "fm", waveform: "sine", modulationIndex: 2.8, modulationRatio: 1.01, brightness: 0.42 };
  }
  if (sound.includes("bell") || sound.includes("lattice")) {
    return { ...voice, mode: "fm", waveform: "sine", modulationIndex: 6.2, modulationRatio: 2.72, brightness: 0.78, decay: voice.decay * 1.8 };
  }
  if (sound.includes("spiral") || sound.includes("shepard")) {
    return { ...voice, mode: "shepard", waveform: "sine", shepardWidth: 5, shepardRate: 0.16, brightness: 0.66 };
  }
  if (sound.includes("delay") || sound.includes("glass")) {
    return { ...voice, mode: "pm", waveform: "sine", modulationIndex: 3.5, modulationRatio: 1.618, brightness: 0.72 };
  }
  if (sound.includes("pad") || sound.includes("bed") || event?.role === "texture") {
    return {
      ...voice,
      mode: "sine",
      waveform: "triangle",
      attack: Math.min(0.18, voice.decay * 0.25),
      decay: Math.max(0.45, voice.decay * 1.5),
      brightness: 0.38,
      gain: voice.gain * 0.72,
    };
  }
  if (sound.includes("sample") || sound.includes("voice")) {
    return { ...voice, mode: "fm", modulationIndex: 1.4, modulationRatio: 2.02, brightness: 0.58 };
  }
  return { ...voice, mode: identity % 2 ? "fm" : "sine", modulationIndex: 1.8 + (identity % 23) / 10 };
}

function isPercussion(event) {
  const type = String(event?.instrumentType ?? "").toLowerCase();
  const id = String(event?.instrumentId ?? "").toLowerCase();
  const role = String(event?.role ?? "").toLowerCase();
  return type.includes("drum")
    || type.includes("percussion")
    || id.includes("drum")
    || role === "rhythm"
    || role === "percussion";
}

/** Composer adapter around Morphazoid's existing FM drum and graph synth engines. */
export class ConstellationAudio {
  constructor(runtime = globalThis, { drums, synth } = {}) {
    this.runtime = runtime;
    this.drums = drums ?? new FmDrumAudio(runtime);
    this.synth = synth ?? new GraphSynthAudio(runtime);
    this.drumVoices = cloneDefaultFmDrumVoices();
    this.output = 0.54;
    this.started = false;
    this.startPromise = null;
  }

  get contexts() {
    return [this.drums?.context, this.synth?.context].filter(Boolean);
  }

  async start() {
    if (this.startPromise) return this.startPromise;
    const promise = Promise.all([this.drums.start(), this.synth.start()]);
    this.startPromise = promise;
    try {
      await promise;
      this.started = true;
      this.setOutput(this.output);
      return this.contexts;
    } finally {
      if (this.startPromise === promise) this.startPromise = null;
    }
  }

  setOutput(value) {
    this.output = clamp(value, 0, 0.85, 0.54);
    // Each renderer owns a protected final bus. Conservative parallel levels
    // retain headroom when rhythm and harmony arrive on the same graph join.
    this.drums?.setOutput?.(this.output * 0.72);
    this.synth?.setOutput?.(this.output * 0.68);
  }

  async trigger(event, { delaySeconds = 0, secondsPerBeat = 0.5 } = {}) {
    if (!this.started) await this.start();
    const delay = Math.max(0, finite(delaySeconds, 0));
    if (isPercussion(event)) {
      const base = this.drumVoices[drumVoiceIndex(event)] ?? this.drumVoices[0];
      const voice = {
        ...base,
        level: clamp(base.level * clamp(event?.velocity, 0, 1, 0.8), 0.01, 1, base.level),
        frequency: clamp(base.frequency * 2 ** (((event?.note ?? 60) - 60) / 36), 24, 12_000, base.frequency),
      };
      return this.drums.trigger(voice, {
        startAt: (this.drums.context?.currentTime ?? 0) + delay,
      });
    }

    const voice = pitchedVoice(event, secondsPerBeat);
    return this.synth.trigger(voice, {
      startAt: (this.synth.context?.currentTime ?? 0) + delay,
      attackSeconds: voice.attack,
      decaySeconds: voice.decay,
      gateSeconds: Math.max(0.02, finite(event?.durationBeats, 0.5) * secondsPerBeat * 0.72),
      sustainLevel: voice.attack > 0.03 ? 0.58 : 0.28,
      releaseSeconds: Math.max(0.04, Math.min(1.4, voice.decay * 0.7)),
    });
  }

  silence() {
    this.drums?.silence?.();
    this.synth?.silence?.();
  }

  async close() {
    this.started = false;
    this.startPromise = null;
    await Promise.allSettled([
      this.drums?.close?.(),
      this.synth?.close?.(),
    ]);
  }
}

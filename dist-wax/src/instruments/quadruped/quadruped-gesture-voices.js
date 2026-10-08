import { QUADRUPED_CALLS, quadrupedCalls } from "./quadruped-voices.js";

const ARPEGGIOS = new Set(["Sparkle", "Prism", "Marimba", "Neck harp", "Click song"]);
const TAU = Math.PI * 2;
const FLOOR = 0.0001;
const bounded = (value, low, high, fallback) => {
  const number = Number(value);
  return Math.min(high, Math.max(low, Number.isFinite(number) ? number : fallback));
};
const REST = Object.freeze({
  active: false, kind: null, gesture: null, strength: 0, progress: 1,
  noteIndex: -1, notePulse: 0, trunkRaise: 0, hornPulse: 0, headToss: 0,
  earFlick: 0, whiskerPulse: 0, spineFlex: 0, neckSway: 0, tongueFlick: 0,
  throatPulse: 0,
});

/** A temporary performance, never a score edit. Notes retain fractional MIDI
 * pitches so an upward/downward head drag can transpose continuously. */
export function createQuadrupedGestureCall(score, { row = 0, strength = 0.8, pitch = 0 } = {}) {
  const animalId = Object.hasOwn(QUADRUPED_CALLS, score?.animalId) ? score.animalId : "elephant";
  const voices = quadrupedCalls(animalId);
  const selectedRow = Math.trunc(bounded(row, 0, voices.length - 1, 0));
  const voice = voices[selectedRow];
  const semitones = bounded(pitch, -12, 12, 0);
  const intensity = bounded(strength, 0, 1, 0.8);
  const tempo = bounded(score?.tempoBpm ?? 96, 25, 500, 96);
  const duration = bounded(voice.beats * 60 / tempo, 0.09, 1.8, 0.5);
  const arpeggio = ARPEGGIOS.has(voice.label);
  const noteDuration = Math.min(1.4, Math.max(0.025, duration / 3));
  return Object.freeze({
    ...voice, animalId, row: selectedRow, pitch: semitones, intensity, duration,
    notes: Object.freeze(voice.notes.map(note => note + semitones)),
    noteOffsetsSeconds: Object.freeze(voice.notes.map((_, index) => index / voice.notes.length * duration * 0.8)),
    articulation: arpeggio ? "arpeggio" : "contour",
    // Match scheduleCall/schedulePitchContour, including Strings' slower
    // onset and the short separate attacks in the five arpeggio voices.
    attackSeconds: arpeggio ? Math.min(0.003, noteDuration * 0.35)
      : Math.min(voice.label === "Strings" ? 0.075 : 0.016, duration * 0.28),
    undertoneAttackSeconds: arpeggio ? 0 : Math.min(0.022, duration * 0.28),
    releaseStartSeconds: arpeggio ? 0 : duration * 0.72,
    releaseSeconds: arpeggio ? noteDuration - 0.003 : duration * 0.28,
    noteDurationSeconds: noteDuration,
  });
}

function exponential(from, to, progress) {
  return from * (to / from) ** Math.min(1, Math.max(0, progress));
}

// The audio ramps end at a small positive floor before the source stops.
// Remove that floor for animation so the resting pose is exactly neutral.
function envelope(elapsed, duration, attack, peak, sustainAt = null) {
  if (elapsed <= 0 || elapsed >= duration) return 0;
  const maximum = Math.max(0.0002, peak);
  let gain;
  if (elapsed < attack) gain = exponential(FLOOR, maximum, elapsed / attack);
  else if (sustainAt !== null && elapsed < sustainAt) {
    gain = exponential(maximum, Math.max(0.0002, maximum * 0.72), (elapsed - attack) / (sustainAt - attack));
  } else {
    const start = sustainAt ?? attack;
    const from = sustainAt === null ? maximum : Math.max(0.0002, maximum * 0.72);
    gain = exponential(from, FLOOR, (elapsed - start) / (duration - start));
  }
  return Math.min(1, Math.max(0, (gain - FLOOR) / (maximum - FLOOR)));
}

/** Read the descriptor against elapsed audio-clock seconds. Callers can use a
 * monotonic wall clock for silent previews while Audio is off. No clock, audio
 * node, transport, or actor state is owned by this helper. */
export function quadrupedGestureCallPerformance(call, elapsedSeconds) {
  const elapsed = Number(elapsedSeconds);
  const duration = Number(call?.duration);
  const intensity = bounded(call?.intensity, 0, 1, 0);
  if (!Number.isFinite(elapsed) || !Number.isFinite(duration) || duration <= 0
    || elapsed < 0 || elapsed >= duration || intensity <= 0
    || !Array.isArray(call?.notes) || !call.notes.length) return REST;
  const progress = elapsed / duration;
  const noteCount = Math.min(6, call.notes.length);
  const offsets = Array.from({ length: noteCount }, (_, index) => index / noteCount * duration * 0.8);
  const noteIndex = Math.max(0, offsets.findLastIndex(offset => offset <= elapsed));
  const arpeggio = ARPEGGIOS.has(call.label);
  let amount;
  if (arpeggio) {
    const noteDuration = Math.min(1.4, Math.max(0.025, duration / 3));
    const attack = Math.min(0.003, noteDuration * 0.35);
    amount = Math.max(...offsets.map(offset => envelope(elapsed - offset, noteDuration, attack, 0.14 * intensity)));
  } else {
    const attack = Math.min(call.label === "Strings" ? 0.075 : 0.016, duration * 0.28);
    const undertoneAttack = Math.min(0.022, duration * 0.28);
    const main = envelope(elapsed, duration, attack, 0.19 * intensity, duration * 0.72);
    const undertone = envelope(elapsed, duration, undertoneAttack, 0.055 * intensity, duration * 0.72);
    amount = (main * 0.19 + undertone * 0.055) / 0.245;
  }
  const pulseRate = bounded(call.pulse, 0, 40, 0);
  const pulse = pulseRate ? 0.58 + 0.42 * Math.sin(elapsed * pulseRate * TAU) : 1;
  const strength = Math.min(1, Math.max(0, intensity * amount * pulse));
  const notePulse = strength * (pulseRate ? pulse : 0.45 + 0.55 * Math.max(0, Math.sin(progress * Math.PI * Math.max(2, noteCount))));
  const gesture = call.gesture;
  return Object.freeze({
    active: true, kind: call.label, gesture, strength, progress, noteIndex, notePulse,
    trunkRaise: gesture === "trunk-lift" ? strength : 0,
    hornPulse: gesture === "horn-neigh" ? Math.max(strength * 0.42, notePulse) : 0,
    headToss: gesture === "head-toss" ? strength * 0.52 + notePulse * 0.48 : 0,
    earFlick: gesture === "head-toss" ? notePulse * (noteIndex % 2 === 0 ? 1 : 0.62) : 0,
    whiskerPulse: gesture === "whisker-meow" ? Math.max(strength * 0.5, notePulse) : 0,
    spineFlex: gesture === "spine-chirp" ? strength * (noteIndex % 2 ? -1 : 1) : 0,
    neckSway: gesture === "neck-sway" ? strength * Math.sin((noteIndex + progress) * Math.PI * 0.7) : 0,
    tongueFlick: gesture === "tongue-flick" ? notePulse : 0,
    throatPulse: gesture === "throat-pulse" ? notePulse : 0,
  });
}

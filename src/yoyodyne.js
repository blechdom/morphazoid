export const YOYODYNE_LIMITS = Object.freeze({
  bars: 4,
  beatsPerBar: 4,
  loopBeats: 16,
  minimumPitch: 48,
  maximumPitch: 84,
  minimumDurationBeats: 0.25,
  maximumDurationBeats: 4,
  minimumTempo: 50,
  maximumTempo: 180,
  maximumNotes: 24,
  maximumScheduledEvents: 64,
});

export const YOYODYNE_AUDIO_TIMING = Object.freeze({
  schedulerIntervalMilliseconds: 25,
  lookaheadSeconds: 0.16,
  minimumLeadSeconds: 0.025,
  startLeadSeconds: 0.06,
});

export const YOYODYNE_VOICE_ROLES = Object.freeze(["throat", "mouth", "halo"]);

const PITCH_NAMES = Object.freeze([
  "C", "C♯", "D", "D♯", "E", "F",
  "F♯", "G", "G♯", "A", "A♯", "B",
]);

const DEFAULT_PHRASE = Object.freeze([
  { id: "sig-01", voiceRole: "throat", startBeat: 0, durationBeats: 3.5, pitch: 48, bendCents: [-18, 7, -4], energy: 0.72 },
  { id: "sig-02", voiceRole: "mouth", startBeat: 0, durationBeats: 2, pitch: 55, bendCents: [6, -9, 2], energy: 0.6 },
  { id: "sig-03", voiceRole: "halo", startBeat: 0, durationBeats: 1.25, pitch: 64, bendCents: [-4, 16, 1], energy: 0.45 },
  { id: "sig-04", voiceRole: "halo", startBeat: 2.25, durationBeats: 1, pitch: 67, bendCents: [-20, 14, -3], energy: 0.52 },
  { id: "sig-05", voiceRole: "throat", startBeat: 4, durationBeats: 3.5, pitch: 53, bendCents: [-14, 8, -2], energy: 0.7 },
  { id: "sig-06", voiceRole: "mouth", startBeat: 4, durationBeats: 2, pitch: 60, bendCents: [7, -8, 3], energy: 0.61 },
  { id: "sig-07", voiceRole: "halo", startBeat: 4, durationBeats: 1.25, pitch: 69, bendCents: [-6, 14, 2], energy: 0.47 },
  { id: "sig-08", voiceRole: "halo", startBeat: 6.25, durationBeats: 1, pitch: 67, bendCents: [-17, 12, -2], energy: 0.54 },
  { id: "sig-09", voiceRole: "throat", startBeat: 8, durationBeats: 3.5, pitch: 56, bendCents: [-18, 5, -4], energy: 0.74 },
  { id: "sig-10", voiceRole: "mouth", startBeat: 8, durationBeats: 2, pitch: 63, bendCents: [6, -11, 2], energy: 0.62 },
  { id: "sig-11", voiceRole: "halo", startBeat: 8, durationBeats: 1.25, pitch: 72, bendCents: [-5, 19, 0], energy: 0.44 },
  { id: "sig-12", voiceRole: "halo", startBeat: 10.25, durationBeats: 1, pitch: 70, bendCents: [-19, 13, -2], energy: 0.5 },
  { id: "sig-13", voiceRole: "throat", startBeat: 12, durationBeats: 3.75, pitch: 55, bendCents: [-15, 9, -3], energy: 0.73 },
  { id: "sig-14", voiceRole: "mouth", startBeat: 12, durationBeats: 2, pitch: 62, bendCents: [5, -10, 2], energy: 0.61 },
  { id: "sig-15", voiceRole: "halo", startBeat: 12, durationBeats: 1.25, pitch: 71, bendCents: [-3, 17, 1], energy: 0.45 },
  { id: "sig-16", voiceRole: "halo", startBeat: 14.25, durationBeats: 1.25, pitch: 72, bendCents: [-16, 20, -5], energy: 0.56 },
]);

const VOICE_ROLE_SET = new Set(YOYODYNE_VOICE_ROLES);

function finite(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

export function clampYoyodyne(value, minimum, maximum, fallback = minimum) {
  return Math.min(maximum, Math.max(minimum, finite(value, fallback)));
}

function rounded(value, places = 4) {
  const scale = 10 ** places;
  return Math.round(value * scale) / scale;
}

function snapPitch(value, mode) {
  const bounded = clampYoyodyne(
    value,
    YOYODYNE_LIMITS.minimumPitch,
    YOYODYNE_LIMITS.maximumPitch,
    60,
  );
  return mode === "chromatic" ? Math.round(bounded) : rounded(bounded, 2);
}

function snapBeat(value, mode) {
  const quantum = mode === "eighth" ? 0.5 : 0.01;
  return rounded(Math.round(finite(value, 0) / quantum) * quantum, 2);
}

function sanitizeContour(value) {
  const source = Array.isArray(value) ? value : [0, 0, 0];
  return Object.freeze([0, 1, 2].map((index) => (
    clampYoyodyne(source[index], -50, 50, 0)
  )));
}

function freezeNote(source, index, {
  pitchSnap = "free",
  timeSnap = "free",
} = {}) {
  const pitch = snapPitch(source?.pitch, pitchSnap);
  const startBeat = clampYoyodyne(
    snapBeat(source?.startBeat, timeSnap),
    0,
    YOYODYNE_LIMITS.loopBeats - YOYODYNE_LIMITS.minimumDurationBeats,
    index,
  );
  const durationMaximum = Math.min(
    YOYODYNE_LIMITS.maximumDurationBeats,
    YOYODYNE_LIMITS.loopBeats - startBeat,
  );
  const durationBeats = clampYoyodyne(
    snapBeat(source?.durationBeats, timeSnap),
    YOYODYNE_LIMITS.minimumDurationBeats,
    durationMaximum,
    YOYODYNE_LIMITS.minimumDurationBeats,
  );
  const fallbackVoiceRole = pitch < 57 ? "throat" : pitch < 66 ? "mouth" : "halo";
  return Object.freeze({
    id: String(source?.id ?? `sig-${String(index + 1).padStart(2, "0")}`),
    startBeat,
    durationBeats,
    pitch,
    bendCents: sanitizeContour(source?.bendCents),
    energy: clampYoyodyne(source?.energy, 0.2, 1, 0.7),
    voiceRole: VOICE_ROLE_SET.has(source?.voiceRole) ? source.voiceRole : fallbackVoiceRole,
  });
}

export function sanitizeYoyodyneNotes(notes, options = {}) {
  if (!Array.isArray(notes)) return Object.freeze([]);
  const seenIds = new Set();
  const result = [];
  for (const source of notes.slice(0, YOYODYNE_LIMITS.maximumNotes)) {
    const note = freezeNote(source, result.length, options);
    if (seenIds.has(note.id)) continue;
    seenIds.add(note.id);
    result.push(note);
  }
  result.sort((left, right) => (
    left.startBeat - right.startBeat || left.pitch - right.pitch || left.id.localeCompare(right.id)
  ));
  return Object.freeze(result);
}

export function createYoyodynePhrase() {
  return sanitizeYoyodyneNotes(DEFAULT_PHRASE);
}

export function updateYoyodyneNote(notes, noteId, changes = {}, options = {}) {
  const source = sanitizeYoyodyneNotes(notes);
  const index = source.findIndex((note) => note.id === noteId);
  if (index < 0) return source;
  const patch = { ...changes };
  if (Object.hasOwn(patch, "pitch")) {
    patch.pitch = snapPitch(patch.pitch, options.pitchSnap);
  }
  if (Object.hasOwn(patch, "startBeat")) {
    patch.startBeat = snapBeat(patch.startBeat, options.timeSnap);
  }
  if (Object.hasOwn(patch, "durationBeats")) {
    patch.durationBeats = snapBeat(patch.durationBeats, options.timeSnap);
  }
  const replacement = freezeNote({ ...source[index], ...patch }, index);
  return sanitizeYoyodyneNotes(
    source.map((note, noteIndex) => noteIndex === index ? replacement : note),
  );
}

export function restoreYoyodyneNote(notes, noteId, originals = createYoyodynePhrase()) {
  const original = sanitizeYoyodyneNotes(originals).find((note) => note.id === noteId);
  return original ? updateYoyodyneNote(notes, noteId, original) : sanitizeYoyodyneNotes(notes);
}

export function midiToFrequency(midi) {
  const pitch = clampYoyodyne(
    midi,
    YOYODYNE_LIMITS.minimumPitch,
    YOYODYNE_LIMITS.maximumPitch,
    69,
  );
  return 440 * 2 ** ((pitch - 69) / 12);
}

export function formatYoyodynePitch(midi) {
  const pitch = clampYoyodyne(
    midi,
    YOYODYNE_LIMITS.minimumPitch,
    YOYODYNE_LIMITS.maximumPitch,
    60,
  );
  const nearest = Math.round(pitch);
  const cents = Math.round((pitch - nearest) * 100);
  const name = `${PITCH_NAMES[((nearest % 12) + 12) % 12]}${Math.floor(nearest / 12) - 1}`;
  if (!cents) return name;
  return `${name} ${cents > 0 ? "+" : ""}${cents}¢`;
}

export function yoyodyneBeatWithinLoop(scoreBeat = 0) {
  const loop = YOYODYNE_LIMITS.loopBeats;
  const safe = Math.max(0, finite(scoreBeat, 0));
  return ((safe % loop) + loop) % loop;
}

export function yoyodyneNotesAtBeat(notes, scoreBeat = 0) {
  const beat = yoyodyneBeatWithinLoop(scoreBeat);
  return Object.freeze(sanitizeYoyodyneNotes(notes).filter((note) => (
    beat >= note.startBeat && beat < note.startBeat + note.durationBeats
  )));
}

export function yoyodyneNoteAtBeat(notes, scoreBeat = 0) {
  return yoyodyneNotesAtBeat(notes, scoreBeat)[0] ?? null;
}

export function yoyodyneMaximumPolyphony(notes) {
  const events = sanitizeYoyodyneNotes(notes).flatMap((note) => [
    { beat: note.startBeat, change: 1 },
    { beat: note.startBeat + note.durationBeats, change: -1 },
  ]);
  events.sort((left, right) => left.beat - right.beat || left.change - right.change);
  let active = 0;
  let maximum = 0;
  for (const event of events) {
    active = Math.max(0, active + event.change);
    maximum = Math.max(maximum, active);
  }
  return maximum;
}

export function yoyodyneScoreBeatAtAudioTime({
  scoreAnchorBeat = 0,
  audioAnchorTime = 0,
  audioTime = audioAnchorTime,
  tempo = 96,
} = {}) {
  const beatsPerSecond = clampYoyodyne(
    tempo,
    YOYODYNE_LIMITS.minimumTempo,
    YOYODYNE_LIMITS.maximumTempo,
    96,
  ) / 60;
  return Math.max(
    0,
    finite(scoreAnchorBeat, 0)
      + (finite(audioTime, audioAnchorTime) - finite(audioAnchorTime, 0)) * beatsPerSecond,
  );
}

function safeOrdinal(value) {
  return Math.min(
    Number.MAX_SAFE_INTEGER,
    Math.max(0, Math.floor(finite(value, 0))),
  );
}

function firstOrdinalAtOrAfterBeat(notes, beat) {
  const loop = YOYODYNE_LIMITS.loopBeats;
  const safeBeat = Math.max(0, finite(beat, 0));
  const cycle = Math.floor(safeBeat / loop);
  const position = safeBeat - cycle * loop;
  const epsilon = Math.max(1e-9, safeBeat * Number.EPSILON * 4);
  const index = notes.findIndex((note) => note.startBeat >= position - epsilon);
  return safeOrdinal(index >= 0
    ? cycle * notes.length + index
    : (cycle + 1) * notes.length);
}

export function yoyodyneOccurrenceAtOrdinal({
  notes,
  ordinal = 0,
  tempo = 96,
  scoreAnchorBeat = 0,
  audioAnchorTime = 0,
} = {}) {
  const timeline = sanitizeYoyodyneNotes(notes);
  if (!timeline.length) return null;
  const safe = safeOrdinal(ordinal);
  const index = safe % timeline.length;
  const cycle = Math.floor(safe / timeline.length);
  const note = timeline[index];
  const beatsPerSecond = clampYoyodyne(
    tempo,
    YOYODYNE_LIMITS.minimumTempo,
    YOYODYNE_LIMITS.maximumTempo,
    96,
  ) / 60;
  const startBeat = cycle * YOYODYNE_LIMITS.loopBeats + note.startBeat;
  const startAt = finite(audioAnchorTime, 0)
    + (startBeat - Math.max(0, finite(scoreAnchorBeat, 0))) / beatsPerSecond;
  return Object.freeze({
    note,
    ordinal: safe,
    index,
    cycle,
    startBeat,
    startAt,
    durationSeconds: note.durationBeats / beatsPerSecond,
    nextEventOrdinal: safe < Number.MAX_SAFE_INTEGER ? safe + 1 : safe,
  });
}

export function planYoyodyneAudioWindow({
  notes,
  nextEventOrdinal = 0,
  tempo = 96,
  scoreAnchorBeat = 0,
  audioAnchorTime = 0,
  nowAudioTime = 0,
  lookaheadSeconds = YOYODYNE_AUDIO_TIMING.lookaheadSeconds,
  minimumLeadSeconds = YOYODYNE_AUDIO_TIMING.minimumLeadSeconds,
  maximumEvents = YOYODYNE_LIMITS.maximumScheduledEvents,
} = {}) {
  const timeline = sanitizeYoyodyneNotes(notes);
  const cursor = safeOrdinal(nextEventOrdinal);
  if (!timeline.length) {
    return Object.freeze({
      entries: Object.freeze([]),
      nextEventOrdinal: cursor,
      skippedCount: 0,
    });
  }
  const now = finite(nowAudioTime, 0);
  const lookahead = clampYoyodyne(lookaheadSeconds, 0, 1, 0.16);
  const lead = clampYoyodyne(minimumLeadSeconds, 0, lookahead, 0.025);
  const threshold = now + lead;
  const horizon = now + lookahead;
  const thresholdBeat = yoyodyneScoreBeatAtAudioTime({
    scoreAnchorBeat,
    audioAnchorTime,
    audioTime: threshold,
    tempo,
  });
  const firstTimely = firstOrdinalAtOrAfterBeat(timeline, thresholdBeat);
  let ordinal = Math.max(cursor, firstTimely);
  const skippedCount = Math.max(0, firstTimely - cursor);
  const limit = Math.max(1, Math.min(
    YOYODYNE_LIMITS.maximumScheduledEvents,
    Math.floor(finite(maximumEvents, YOYODYNE_LIMITS.maximumScheduledEvents)),
  ));
  const entries = [];
  while (entries.length < limit && ordinal < Number.MAX_SAFE_INTEGER) {
    const occurrence = yoyodyneOccurrenceAtOrdinal({
      notes: timeline,
      ordinal,
      tempo,
      scoreAnchorBeat,
      audioAnchorTime,
    });
    if (!occurrence || occurrence.startAt > horizon) break;
    if (occurrence.startAt >= threshold) entries.push(occurrence);
    ordinal += 1;
  }
  return Object.freeze({
    entries: Object.freeze(entries),
    nextEventOrdinal: ordinal,
    skippedCount,
  });
}

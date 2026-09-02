/**
 * Audio-first transport constants for Enveloper.
 *
 * The scheduler wakes more often than its lookahead horizon, while a distinct
 * start lead gives a newly armed transport enough time to queue its first
 * native Web Audio nodes.
 */
export const ENVELOPER_AUDIO_TIMING = Object.freeze({
  schedulerIntervalMilliseconds: 25,
  schedulerIntervalSeconds: 0.025,
  lookaheadSeconds: 0.16,
  minimumLeadSeconds: 0.025,
  startLeadSeconds: 0.06,
  maxEvents: 64,
});

const MAX_EVENT_COUNT = ENVELOPER_AUDIO_TIMING.maxEvents;
const MAX_ORDINAL = Number.MAX_SAFE_INTEGER;

function finite(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function nonNegative(value, fallback = 0) {
  return Math.max(0, finite(value, fallback));
}

function positive(value, fallback) {
  const number = finite(value, fallback);
  return number > 0 ? number : fallback;
}

function safeOrdinal(value, fallback = 0) {
  const number = Math.floor(nonNegative(value, fallback));
  return Math.min(MAX_ORDINAL, number);
}

function boundaryTolerance(score, cycleSeconds) {
  return Math.max(
    1e-12,
    Math.abs(finite(score, 0)) * Number.EPSILON * 4,
    Math.abs(finite(cycleSeconds, 0)) * Number.EPSILON * 4,
  );
}

function eventBounds(event, cycleSeconds) {
  if (!event || typeof event !== "object") return null;
  const startSeconds = Number(event.startSeconds);
  const explicitEnd = Number(event.endSeconds);
  const durationSeconds = Number(event.durationSeconds);
  const endSeconds = Number.isFinite(explicitEnd)
    ? explicitEnd
    : Number.isFinite(durationSeconds) ? startSeconds + durationSeconds : Number.NaN;
  if (
    !Number.isFinite(startSeconds)
    || !Number.isFinite(endSeconds)
    || startSeconds < 0
    || endSeconds <= startSeconds
    || endSeconds > cycleSeconds
  ) return null;
  return { startSeconds, endSeconds };
}

function validTimeline(events, cycleSeconds) {
  if (!Array.isArray(events) || events.length === 0) return null;
  if (events.length > MAX_EVENT_COUNT) return null;
  const duration = Number(cycleSeconds);
  if (!Number.isFinite(duration) || duration <= 0) return null;

  const bounds = [];
  let previousEnd = 0;
  for (let index = 0; index < events.length; index += 1) {
    const current = eventBounds(events[index], duration);
    if (!current || current.startSeconds < previousEnd) return null;
    bounds.push(current);
    previousEnd = current.endSeconds;
  }
  return { events, bounds, cycleSeconds: duration };
}

function emptyPlan(nextEventOrdinal = 0) {
  return Object.freeze({
    entries: Object.freeze([]),
    nextEventOrdinal: safeOrdinal(nextEventOrdinal),
    skippedCount: 0,
  });
}

/** Map an AudioContext time onto the transport's monotonically increasing score. */
export function enveloperScoreAtAudioTime({
  scoreAnchorSeconds = 0,
  audioAnchorTime = 0,
  audioTime = audioAnchorTime,
} = {}) {
  const scoreAnchor = nonNegative(scoreAnchorSeconds);
  const audioAnchor = finite(audioAnchorTime, 0);
  const currentAudioTime = finite(audioTime, audioAnchor);
  return Math.max(0, scoreAnchor + currentAudioTime - audioAnchor);
}

/**
 * Resolve a score position to its variable-duration event occurrence.
 * Event intervals are half-open, so an exact boundary belongs to its right
 * event and an exact cycle boundary belongs to event zero of the next cycle.
 */
export function enveloperEventAtScore({
  events,
  cycleSeconds,
  scoreSeconds = 0,
} = {}) {
  const timeline = validTimeline(events, cycleSeconds);
  if (!timeline) return null;

  const score = nonNegative(scoreSeconds);
  const epsilon = boundaryTolerance(score, timeline.cycleSeconds);
  let cycle = Math.floor(score / timeline.cycleSeconds);
  let cycleStart = cycle * timeline.cycleSeconds;
  let position = score - cycleStart;
  if (timeline.cycleSeconds - position <= epsilon) {
    cycle += 1;
    cycleStart = cycle * timeline.cycleSeconds;
    position = 0;
  }
  const index = timeline.bounds.findIndex(({ startSeconds, endSeconds }) => (
    position >= startSeconds - epsilon && position < endSeconds - epsilon
  ));
  if (index < 0) return null;

  const bounds = timeline.bounds[index];
  const startSeconds = cycleStart + bounds.startSeconds;
  const endSeconds = cycleStart + bounds.endSeconds;
  const ordinal = cycle * timeline.events.length + index;
  if (!Number.isSafeInteger(ordinal)) return null;
  const progress = Math.min(1, Math.max(
    0,
    (score - startSeconds) / (endSeconds - startSeconds),
  ));

  return Object.freeze({
    event: timeline.events[index],
    index,
    cycle,
    ordinal,
    startSeconds,
    endSeconds,
    progress,
    nextEventOrdinal: ordinal + 1,
  });
}

/** Resolve an integer event ordinal to exact score and AudioContext times. */
export function enveloperOccurrenceAtOrdinal({
  events,
  cycleSeconds,
  ordinal = 0,
  scoreAnchorSeconds = 0,
  audioAnchorTime = 0,
} = {}) {
  const timeline = validTimeline(events, cycleSeconds);
  if (!timeline) return null;
  const safe = safeOrdinal(ordinal);
  const index = safe % timeline.events.length;
  const cycle = Math.floor(safe / timeline.events.length);
  const bounds = timeline.bounds[index];
  const startSeconds = cycle * timeline.cycleSeconds + bounds.startSeconds;
  const endSeconds = cycle * timeline.cycleSeconds + bounds.endSeconds;
  const scoreAnchor = nonNegative(scoreAnchorSeconds);
  const audioAnchor = finite(audioAnchorTime, 0);
  const startAt = audioAnchor + startSeconds - scoreAnchor;
  const endAt = audioAnchor + endSeconds - scoreAnchor;

  if (![startSeconds, endSeconds, startAt, endAt].every(Number.isFinite)) return null;
  return Object.freeze({
    event: timeline.events[index],
    index,
    cycle,
    ordinal: safe,
    startSeconds,
    endSeconds,
    progress: 0,
    nextEventOrdinal: safe < MAX_ORDINAL ? safe + 1 : MAX_ORDINAL,
    startAt,
    endAt,
    durationSeconds: endSeconds - startSeconds,
  });
}

function firstOrdinalAtOrAfterAudioTime({
  timeline,
  scoreAnchorSeconds,
  audioAnchorTime,
  audioTime,
}) {
  const score = finite(scoreAnchorSeconds, 0)
    + finite(audioTime, 0)
    - finite(audioAnchorTime, 0);
  if (score <= 0) return 0;

  const cycle = Math.floor(score / timeline.cycleSeconds);
  const position = score - cycle * timeline.cycleSeconds;
  const epsilon = boundaryTolerance(score, timeline.cycleSeconds);
  const index = timeline.bounds.findIndex(({ startSeconds }) => (
    startSeconds >= position - epsilon
  ));
  const ordinal = index >= 0
    ? cycle * timeline.events.length + index
    : (cycle + 1) * timeline.events.length;
  return safeOrdinal(ordinal);
}

/**
 * Plan every not-yet-scheduled occurrence inside one absolute audio window.
 *
 * A cursor older than `now + minimumLeadSeconds` is advanced directly using
 * cycle/event ordinals. Stale attacks are counted, never replayed in a burst.
 */
export function planEnveloperAudioWindow({
  events,
  cycleSeconds,
  nextEventOrdinal = 0,
  scoreAnchorSeconds = 0,
  audioAnchorTime = 0,
  nowAudioTime = 0,
  lookaheadSeconds = ENVELOPER_AUDIO_TIMING.lookaheadSeconds,
  minimumLeadSeconds = ENVELOPER_AUDIO_TIMING.minimumLeadSeconds,
  maxEvents = ENVELOPER_AUDIO_TIMING.maxEvents,
} = {}) {
  const timeline = validTimeline(events, cycleSeconds);
  if (!timeline) return emptyPlan(nextEventOrdinal);

  const now = finite(nowAudioTime, 0);
  const lookahead = nonNegative(
    lookaheadSeconds,
    ENVELOPER_AUDIO_TIMING.lookaheadSeconds,
  );
  const minimumLead = Math.min(
    lookahead,
    nonNegative(minimumLeadSeconds, ENVELOPER_AUDIO_TIMING.minimumLeadSeconds),
  );
  const eventLimit = Math.min(
    ENVELOPER_AUDIO_TIMING.maxEvents,
    Math.max(1, Math.floor(positive(maxEvents, ENVELOPER_AUDIO_TIMING.maxEvents))),
  );
  const threshold = now + minimumLead;
  const horizon = now + lookahead;
  let ordinal = safeOrdinal(nextEventOrdinal);
  const firstTimelyOrdinal = firstOrdinalAtOrAfterAudioTime({
    timeline,
    scoreAnchorSeconds,
    audioAnchorTime,
    audioTime: threshold,
  });
  const skippedCount = Math.max(0, firstTimelyOrdinal - ordinal);
  ordinal = Math.max(ordinal, firstTimelyOrdinal);

  const entries = [];
  while (entries.length < eventLimit && ordinal < MAX_ORDINAL) {
    const occurrence = enveloperOccurrenceAtOrdinal({
      events: timeline.events,
      cycleSeconds: timeline.cycleSeconds,
      ordinal,
      scoreAnchorSeconds,
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

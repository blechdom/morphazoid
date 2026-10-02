/** Resolve an authored beat against this render's note-slot timing.
 * Zero includes native lead-in/pickup. Later offsets are score positions, not
 * claims about acoustic consonant onsets. The audio adapter clamps to PCM.
 */
export function playbackOffsetForBeat(beat, descriptors, result = {}) {
  if (!Number.isFinite(beat)) throw new TypeError('Playback beat must be finite.');
  if (!descriptors?.length) throw new RangeError('Add a note before seeking.');
  const target = Math.max(0, beat);
  if (target === 0) return 0;
  const last = descriptors.at(-1);
  const end = last.startBeats + last.beats;
  if (!Number.isFinite(end) || end < 0) throw new RangeError('This score has no finite beat timeline.');
  const clamped = Math.min(target, end);
  const note = descriptors.find(note => clamped < note.startBeats + note.beats) ?? last;
  const fraction = note.beats > 0 ? Math.max(0, Math.min(1, (clamped - note.startBeats) / note.beats)) : 1;
  const timing = result.noteTimings?.find(timing => timing.index === note.index);
  if (timing && Number.isFinite(timing.start) && Number.isFinite(timing.end) && timing.end >= timing.start) {
    return timing.start * (1 - fraction) + timing.end * fraction;
  }
  const pickup = result.scoreOffsetSeconds ?? 0;
  if (!Number.isFinite(note.startSeconds) || !Number.isFinite(note.seconds) || !Number.isFinite(pickup)) {
    throw new RangeError('Timing is unavailable for this rendered score.');
  }
  return Math.max(0, pickup + note.startSeconds + note.seconds * fraction);
}

// Contacts with onsets in the same short interval share a buffer, including
// their full decay tails. Edits replace whole future intervals, never tails.
// 23 worst-case contact buffers + 16 head voices fit the 48-source budget.
export const QUADRUPED_AUDIO_COHORT_SECONDS = 0.04;
const indexAt = seconds => Math.floor(seconds / QUADRUPED_AUDIO_COHORT_SECONDS + 1e-9);

export function quadrupedAudioBucket(seconds) {
  return indexAt(seconds) * QUADRUPED_AUDIO_COHORT_SECONDS;
}

export function quadrupedAudioCutover(now) {
  return (indexAt(now + 0.008) + 1) * QUADRUPED_AUDIO_COHORT_SECONDS;
}

export function quadrupedAudioHorizon(now, lookahead) {
  return quadrupedAudioBucket(now + lookahead);
}

export function groupQuadrupedContactOnsets(events) {
  const groups = new Map();
  for (const event of events) {
    const index = indexAt(event.when);
    if (!groups.has(index)) groups.set(index, []);
    groups.get(index).push(event);
  }
  return [...groups.entries()].sort(([a], [b]) => a - b).map(([, events]) => events);
}

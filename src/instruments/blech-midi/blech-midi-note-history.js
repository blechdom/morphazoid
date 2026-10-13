/** Bounded performed-score history. Inputs use seconds relative to an independent
 * source clock's present. Forecasts never enter history before their attack.
 * Geometry remembers completed gates after a pad ends or is stopped, without
 * retaining a score, a timer, an audio node, or an unbounded list of generations.
 */
export const BLECH_HISTORY_LIMIT = 24576;
export function createBlechNoteHistory() {
  const records = new Map(), sources = new Map();
  let previousTime = null;
  return {
    update(notes, now, { seconds = 4, limit = BLECH_HISTORY_LIMIT, sourceReleases } = {}) {
      now = Number.isFinite(now) ? now : 0;
      seconds = Math.max(0, Math.min(30, Number(seconds) || 0));
      limit = Math.max(0, Math.min(BLECH_HISTORY_LIMIT, Math.floor(limit)));
      if (!seconds || previousTime !== null && now < previousTime - .001) { records.clear(); sources.clear(); }
      if (!seconds) { previousTime = now; return []; }
      const seen = new Set();
      for (const note of notes) {
        if (!note.id || !(note.start < 0) || !(note.end > -seconds)) continue;
        const sourceKey = `${note.source}:${note.scoreVersion ?? 0}`;
        let source = sources.get(sourceKey);
        if (!source || source.revision !== note.revision) {
          source = { revision: note.revision, since: source ? previousTime ?? now : -Infinity, last: now };
          sources.set(sourceKey, source);
        }
        source.last = now;
        const start = Math.max(now + note.start, source.since);
        if (now + note.end <= start) continue;
        seen.add(note.id);
        const found = records.get(note.id);
        if (found) {
          // Pitch, voice color and the original attack stay immutable after the
          // gate crosses the keyboard. Tempo edits affect only its remaining gate.
          if (found.active) { found.end = Math.min(now, now + note.end); found.expectedEnd = now + note.end; found.active = note.end > 0; }
        } else {
          records.set(note.id, { ...note, start, end: Math.min(now, now + note.end), expectedEnd: now + note.end, active: note.end > 0 });
        }
      }
      for (const [id, note] of records) {
        // A source can pause and resume between display frames. Clock evidence
        // clips its old epoch at the actual release, leaving resumed gates and
        // other independently playing sources untouched.
        const releases = sourceReleases?.get(note.source);
        for (const release of Array.isArray(releases) ? releases : releases ? [releases] : []) {
          if (note.playbackEpoch > release.epoch) continue;
          if (note.start >= release.at) { records.delete(id); break; }
          note.end = Math.min(note.active ? Math.min(now, note.expectedEnd) : note.end, release.at); note.active = false;
        }
        if (note.active && !seen.has(id)) { note.end = Math.min(now, note.expectedEnd); note.active = false; }
        if (note.end <= now - seconds) records.delete(id);
      }
      // Oldest attacks leave first under overload; complete source/audio counts
      // are unaffected. This also bounds layers created rapidly between frames.
      while (sources.size > limit) sources.delete(sources.keys().next().value);
      while (records.size > limit) records.delete(records.keys().next().value);
      for (const [id, source] of sources) if (source.last < now - seconds) sources.delete(id);
      previousTime = now;
      return [...records.values()].map(({ expectedEnd, active, ...note }) => ({ ...note, start: note.start - now, end: note.end - now }));
    },
    clear() { records.clear(); sources.clear(); previousTime = null; },
    get size() { return records.size; },
  };
}

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

export const trackazoidBeatmatchingChanges = JSON.parse(readFileSync(
  new URL('../fixtures/trackazoid-beatmatching-site-amendments.json', import.meta.url), 'utf8',
));

/** Restore the published Trackazoid MVP while keeping its original registration. */
export function restoreTrackazoidBeatmatchingSite(source, file, { allowRestored = false } = {}) {
  if (typeof source !== 'string') return source;
  const change = trackazoidBeatmatchingChanges.changes.find(change => change.file === file);
  if (!change) return source;
  const counts = change.markers.map(marker => source.split(marker).length - 1);
  if (allowRestored && counts.every(count => count === 0)) return source;
  const error = `${file}: exact Trackazoid beatmatching site amendment`;
  for (const count of counts) assert.equal(count, 1, error);
  assert.equal(source.split(change.after).length - 1, 1, error);
  return source.replace(change.after, change.before);
}

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

export const spartialRecordingRuntimeChanges = JSON.parse(readFileSync(
  new URL('../fixtures/spartial-recording-runtime-addition.json', import.meta.url), 'utf8',
));

/** Peel only SPARTIAL's two reviewed recording modules before historical guards. */
export function restoreSpartialRecordingRuntime(source, file, { allowRestored = false } = {}) {
  const change = spartialRecordingRuntimeChanges;
  if (typeof source !== 'string' || file !== change.file) return source;
  const counts = change.additions.map(row => source.split(row).length - 1);
  if (allowRestored && counts.every(count => count === 0)) return source;
  const error = `${file}: exact SPARTIAL recording runtime addition`;
  for (const count of counts) assert.equal(count, 1, error);
  assert.equal(source.split(change.after).length - 1, 1, error);
  return source.replace(change.after, change.before);
}

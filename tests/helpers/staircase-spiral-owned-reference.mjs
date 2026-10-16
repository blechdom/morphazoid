import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

export const staircaseSpiralOwnedChanges = JSON.parse(readFileSync(
  new URL('../fixtures/staircase-spiral-owned-amendments.json', import.meta.url), 'utf8',
));

/** Restore only the reviewed instrument-owned edits before the older WIP proof.
 * Unknown edits survive into that proof; partial or duplicated edits fail here.
 */
export function restoreStaircaseSpiralOwned(source, file) {
  if (typeof source !== 'string') return source;
  const change = staircaseSpiralOwnedChanges.changes.find(item => item.file === file);
  if (!change) return source;
  for (const { before, after } of [...change.replacements].reverse()) {
    assert.equal(source.split(after).length - 1, 1, `${file}: exact Staircase spiral owned amendment`);
    source = source.replace(after, () => before);
  }
  return source;
}

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

export const quadrupedFavesAmendment = JSON.parse(readFileSync(
  new URL('../fixtures/quadruped-faves-amendment.json', import.meta.url), 'utf8',
));

/** Reverse only the approved Faves entry before historical byte comparisons. */
export function restoreQuadrupedFaves(source, file, { allowRestored = false } = {}) {
  if (typeof source !== 'string') return source;
  const change = quadrupedFavesAmendment;
  if (file !== change.file) return source;
  // Older guards also normalize isolated amendment fragments. If this exact
  // addition is absent, leave every byte for those guards to validate.
  if (allowRestored && !source.includes(change.after)) return source;
  assert.equal(source.split(change.after).length - 1, 1, `${file}: exact Quadruped Faves addition`);
  return source.replace(change.after, change.before);
}

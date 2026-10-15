import { restoreGraphonicCalculatorSite } from './graphonic-calculator-site-reference.mjs';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

export const trackazoidPadsChanges = JSON.parse(readFileSync(
  new URL('../fixtures/trackazoid-pads-site-amendments.json', import.meta.url), 'utf8',
));

/** Peel only the reviewed pad/demo additions before the older site proofs. */
export function restoreTrackazoidPadsSite(source, file, { allowRestored = false } = {}) {
  source = restoreGraphonicCalculatorSite(source, file, { allowRestored: true });
  if (typeof source !== 'string') return source;
  const change = trackazoidPadsChanges.changes.find(change => change.file === file);
  if (!change) return source;
  const counts = change.markers.map(marker => source.split(marker).length - 1);
  if (allowRestored && counts.every(count => count === 0)) return source;
  const error = `${file}: exact Trackazoid pads site amendment`;
  for (const count of counts) assert.equal(count, 1, error);
  assert.equal(source.split(change.after).length - 1, 1, error);
  return source.replace(change.after, change.before);
}

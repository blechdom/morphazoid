import { restoreHeaderPresetsBatchSite } from './header-presets-batch-site-reference.mjs';
import { restoreGraphonicCalculatorSite } from './graphonic-calculator-site-reference.mjs';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

export const spartialOrganRuntimeChanges = JSON.parse(readFileSync(
  new URL('../fixtures/spartial-organ-runtime-addition.json', import.meta.url), 'utf8',
));

/** Peel only the reviewed organ helper and research document before older evidence. */
export function restoreSpartialOrganRuntime(source, file, { allowRestored = false } = {}) {
  source = restoreHeaderPresetsBatchSite(source, file, { allowRestored: true });
  source = restoreGraphonicCalculatorSite(source, file, { allowRestored: true });
  const change = spartialOrganRuntimeChanges;
  if (typeof source !== 'string' || file !== change.file) return source;
  const counts = change.replacements.map(({ addition }) => source.split(addition).length - 1);
  if (allowRestored && counts.every(count => count === 0)) return source;
  const error = `${file}: exact SPARTIAL organ runtime addition`;
  for (const count of counts) assert.equal(count, 1, error);
  for (const { before, after } of change.replacements) {
    assert.equal(source.split(after).length - 1, 1, error);
    source = source.replace(after, before);
  }
  return source;
}

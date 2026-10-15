import { restoreHeaderPresetsBatchSite } from './header-presets-batch-site-reference.mjs';
import { restoreGraphonicCalculatorSite } from './graphonic-calculator-site-reference.mjs';
import { restoreTrackazoidSite } from './trackazoid-site-reference.mjs';
import { restoreBlechMidiSite } from './blech-midi-site-reference.mjs';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

export const fractalDelayFavesAmendment = JSON.parse(readFileSync(
  new URL('../fixtures/fractal-delay-faves-amendment.json', import.meta.url), 'utf8',
));

/** Reverse only the approved Faves entry before older catalogue comparisons. */
export function restoreFractalDelayFaves(source, file, { allowRestored = false } = {}) {
  source = restoreHeaderPresetsBatchSite(source, file, { allowRestored: true });
  source = restoreGraphonicCalculatorSite(source, file, { allowRestored: true });
  source = restoreTrackazoidSite(source, file, { allowRestored: true });
  source = restoreBlechMidiSite(source, file, { allowRestored: true });
  const change = fractalDelayFavesAmendment;
  if (file !== change.file) return source;
  if (allowRestored && !source.includes(change.after) && source.split(change.before).length === 2) return source;
  assert.equal(source.split(change.after).length - 1, 1, `${file}: exact Fractal Delay Faves addition`);
  return source.replace(change.after, change.before);
}

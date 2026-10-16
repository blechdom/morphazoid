import { restoreGraphonicCalculatorMathSite } from './graphonic-calculator-math-site-reference.mjs';
import { restoreWipRolloutSite } from './wip-rollout-site-reference.mjs';
import { restoreMicInputBatchSite } from './mic-input-batch-site-reference.mjs';
import { restoreHeaderPresetsBatchSite } from './header-presets-batch-site-reference.mjs';
import { restoreGraphonicCalculatorSite } from './graphonic-calculator-site-reference.mjs';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

export const soundFontsToolbarAmendment = JSON.parse(readFileSync(
  new URL('../fixtures/sound-fonts-toolbar-amendment.json', import.meta.url), 'utf8',
));

/** Peel only the exact audio-only toolbar opt-in before frozen navigation proofs. */
export function restoreSoundFontsToolbar(source, file, { allowRestored = false } = {}) {
  source = restoreGraphonicCalculatorMathSite(source, file, { allowRestored: true });
  source = restoreWipRolloutSite(source, file, { allowRestored: true });
  source = restoreMicInputBatchSite(source, file, { allowRestored: true });
  source = restoreHeaderPresetsBatchSite(source, file, { allowRestored: true });
  source = restoreGraphonicCalculatorSite(source, file, { allowRestored: true });
  const change = soundFontsToolbarAmendment;
  if (typeof source !== 'string' || file !== change.file) return source;
  const count = source.split(change.addition).length - 1;
  const markerCounts = change.markers.map(marker => source.split(marker).length - 1);
  // Other historical helpers can reach these bytes again after restoration.
  // Any surviving fragment still requires the complete, unique approved block.
  if (allowRestored && count === 0 && markerCounts.every(value => value === 0)) return source;
  const error = `${file}: exact Sound Fonts toolbar amendment`;
  assert.equal(count, 1, error);
  for (const markerCount of markerCounts) assert.equal(markerCount, 1, error);
  return source.replace(change.addition, '');
}

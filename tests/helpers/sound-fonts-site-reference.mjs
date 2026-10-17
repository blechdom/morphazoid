import { restoreRoachPerformance } from './roach-synth-performance-reference.mjs';
import { restoreGraphonicCalculatorDrumsSite } from './graphonic-calculator-drums-site-reference.mjs';
import { restoreGraphonicCalculatorMathSite } from './graphonic-calculator-math-site-reference.mjs';
import { restoreWipRolloutSite } from './wip-rollout-site-reference.mjs';
import { restoreMicInputBatchSite } from './mic-input-batch-site-reference.mjs';
import { restoreHeaderPresetsBatchSite } from './header-presets-batch-site-reference.mjs';
import { restoreGraphonicCalculatorSite } from './graphonic-calculator-site-reference.mjs';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { restoreSoundFontsToolbar } from './sound-fonts-toolbar-reference.mjs';
import { restoreSoundFontsShared } from './sound-fonts-shared-reference.mjs';

export const soundFontsSiteChanges = JSON.parse(readFileSync(
  new URL('../fixtures/sound-fonts-site-amendments.json', import.meta.url), 'utf8',
));

/** Remove only the exact Sound Fonts additions before older captured evidence. */
export function restoreSoundFontsSite(source, file, { allowRestored = false } = {}) {
  source = restoreGraphonicCalculatorDrumsSite(source, file, { allowRestored: true });
  source = restoreGraphonicCalculatorMathSite(source, file, { allowRestored: true });
  source = restoreWipRolloutSite(source, file, { allowRestored: true });
  source = restoreMicInputBatchSite(source, file, { allowRestored: true });
  source = restoreHeaderPresetsBatchSite(source, file, { allowRestored: true });
  source = restoreGraphonicCalculatorSite(source, file, { allowRestored: true });
  if (typeof source !== 'string') return source;
  source = restoreSoundFontsShared(source, file, { allowRestored: true });
  source = restoreSoundFontsToolbar(source, file, { allowRestored: true });
  for (const { addition } of soundFontsSiteChanges.changes.filter(change => change.file === file)) {
    const count = source.split(addition).length - 1;
    // Optional historical passes may see already restored bytes. A partial or
    // changed block remains untouched, so the older hash guard still catches it.
    if (allowRestored && count === 0) continue;
    assert.equal(count, 1, `${file}: exact Sound Fonts site amendment`);
    source = source.replace(addition, '');
  }
  source = restoreRoachPerformance(source, file, { allowRestored: true });
  return source;
}
